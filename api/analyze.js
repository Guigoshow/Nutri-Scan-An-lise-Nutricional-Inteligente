// Importa funções do Open Food Facts
import { searchProduct, extractNutritionData } from '../lib/openfoodfacts.js';
import { createHash } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { imageBase64, mimeType, portion = 'media' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Nenhuma imagem recebida.' });
    }

    if (imageBase64.length > 5000000) {
      return res.status(413).json({ error: 'Imagem demasiado grande.' });
    }

    // 🔒 CACHE: Gera hash da imagem para evitar análises duplicadas
    const imageHash = createHash('sha256')
      .update(imageBase64.slice(0, 5000)) // Hash dos primeiros 5000 chars
      .digest('hex');

    const cacheKey = `analysis_${imageHash}_${portion}`;

    // Tenta obter do cache (localStorage do servidor não existe, mas podemos usar memória)
    // Em produção, usar Redis ou similar. Aqui usamos variável global simples.
    if (!global.__nutriCache) global.__nutriCache = {};
    
    if (global.__nutriCache[cacheKey]) {
      console.log('✅ Resultado em cache (mesma foto + mesma porção)');
      return res.status(200).json({ 
        analysis: global.__nutriCache[cacheKey],
        cached: true 
      });
    }

    const dataUri = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

    // Multiplicadores de porção
    const portionMultipliers = {
      'pequena': 0.7,
      'media': 1.0,
      'grande': 1.4
    };

    const multiplier = portionMultipliers[portion] || 1.0;
    const portionLabel = {
      'pequena': 'pequena (reduz ~30%)',
      'media': 'média (quantidade padrão)',
      'grande': 'grande (aumenta ~40%)'
    }[portion] || 'média';

    // Prompt profissional otimizado
    const systemPrompt = `Analisas fotos de refeições com precisão nutricional profissional.

METODOLOGIA OBRIGATÓRIA:
1. Identifica CADA ingrediente visível separadamente
2. Estima o peso de cada ingrediente em gramas (prato padrão ~25-28cm diâmetro)
3. Calcula nutrientes baseado nos pesos
4. Considera método de confeção visível (grelhado, cozido, frito, assado)
5. Valida coerência: calorias = (proteína×4 + hidratos×4 + gordura×9)

CONTEXTO DA PORÇÃO: ${portionLabel}
Ajusta todos os pesos e calorias em conformidade.

REGRAS CRÍTICAS DE PRECISÃO:

✓ PROTEÍNAS (carne/peixe):
  - 100g cru = ~75g cozinhado (perde 25% água)
  - Peito de frango grelhado: 165 kcal/100g cozinhado
  - Carne de vaca grelhada: 250 kcal/100g cozinhado
  - Peixe branco grelhado: 120 kcal/100g cozinhado

✓ HIDRATOS (arroz/massa/batata):
  - 100g cru = ~300g cozinhado (absorve água)
  - Arroz branco cozinhado: 130 kcal/100g
  - Massa cozinhada: 160 kcal/100g
  - Batata cozida: 87 kcal/100g
  - Batata frita: 312 kcal/100g

✓ GORDURAS VISÍVEIS:
  - 1 colher sopa azeite/óleo = 10g = 90 kcal
  - Molhos cremosos: adiciona 50-150 kcal
  - Queijo ralado: 30g = ~120 kcal

✓ VEGETAIS:
  - Brócolos/espinafres: ~35 kcal/100g
  - Cenouras: ~41 kcal/100g
  - Ervilhas: ~81 kcal/100g

NUNCA SUBESTIMES:
- Molhos e temperos (50-200 kcal)
- Azeite/óleo de confeção (90-180 kcal)
- Queijo (100-150 kcal)

FORMATO JSON ESTRITO (sem markdown, sem texto extra):
{
  "tipo": "produto_embalado" | "prato_cozinhado",
  "descricao": "descrição clara (máximo 2 frases)",
  "ingredientes": [
    {"nome": "ingrediente", "peso_g": numero, "calorias": numero}
  ],
  "marca_sugerida": "marca ou null",
  "produto_sugerido": "nome do produto ou null",
  "calorias": numero_inteiro,
  "proteinas_g": numero_inteiro,
  "hidratos_g": numero_inteiro,
  "gorduras_g": numero_inteiro,
  "confianca": 1-5,
  "sugestao": "sugestão prática"
}`;

    // 🔧 FUNÇÃO DE ANÁLISE ÚNICA
    async function analyzeOnce() {
      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.6-27b',
          reasoning_effort: 'none',
          temperature: 0, // 🔒 ZERO para máxima consistência
          seed: 42, // 🔒 SEED FIXO para determinismo
          response_format: { type: 'json_object' }, // 🔒 FORÇA JSON válido
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analisa esta foto (porção ${portionLabel}) e devolve JSON.`,
                },
                {
                  type: 'image_url',
                  image_url: { url: dataUri },
                },
              ],
            },
          ],
        }),
      });

      const groqData = await groqResponse.json();

      if (!groqResponse.ok) {
        throw new Error('Erro Groq: ' + JSON.stringify(groqData));
      }

      let analysisText = groqData.choices?.[0]?.message?.content?.trim() || '';
      analysisText = analysisText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(analysisText);
    }

    // 🔧 MÉTODO: Faz 3 análises e calcula a média (reduz variabilidade)
    async function analyzeWithConsensus() {
      const results = [];
      const errors = [];

      // Faz 3 chamadas paralelas
      const promises = [analyzeOnce(), analyzeOnce(), analyzeOnce()];
      const settled = await Promise.allSettled(promises);

      settled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          errors.push(result.reason);
        }
      });

      if (results.length === 0) {
        throw new Error('Todas as análises falharam: ' + errors.join(', '));
      }

      // Calcula a média dos resultados
      const avgCalorias = Math.round(results.reduce((sum, r) => sum + (r.calorias || 0), 0) / results.length);
      const avgProteinas = Math.round(results.reduce((sum, r) => sum + (r.proteinas_g || 0), 0) / results.length);
      const avgHidratos = Math.round(results.reduce((sum, r) => sum + (r.hidratos_g || 0), 0) / results.length);
      const avgGorduras = Math.round(results.reduce((sum, r) => sum + (r.gorduras_g || 0), 0) / results.length);

      // Usa a descrição da primeira análise (mais completa geralmente)
      const bestDescription = results[0].descricao || '';
      const bestTipo = results[0].tipo || 'prato_cozinhado';
      const bestIngredientes = results[0].ingredientes || [];
      const bestConfianca = Math.round(results.reduce((sum, r) => sum + (r.confianca || 3), 0) / results.length);
      const bestSugestao = results[0].sugestao || '';

      return {
        tipo: bestTipo,
        descricao: bestDescription,
        ingredientes: bestIngredientes,
        marca_sugerida: results[0].marca_sugerida || null,
        produto_sugerido: results[0].produto_sugerido || null,
        calorias: avgCalorias,
        proteinas_g: avgProteinas,
        hidratos_g: avgHidratos,
        gorduras_g: avgGorduras,
        confianca: bestConfianca,
        sugestao: bestSugestao
      };
    }

    let analysis;

    try {
      // 🔧 USA ANÁLISE COM CONSENSO (3 chamadas + média)
      analysis = await analyzeWithConsensus();

      // Validação de campos
      const requiredFields = ['descricao', 'calorias', 'proteinas_g', 'hidratos_g', 'gorduras_g', 'tipo'];
      const missingFields = requiredFields.filter(field => !(field in analysis));

      if (missingFields.length > 0) {
        throw new Error(`Campos em falta: ${missingFields.join(', ')}`);
      }

      if (typeof analysis.descricao !== 'string') {
        throw new Error('Campo "descricao" inválido');
      }
      if (typeof analysis.calorias !== 'number' || analysis.calorias < 0) {
        throw new Error('Campo "calorias" inválido');
      }
      if (!['produto_embalado', 'prato_cozinhado'].includes(analysis.tipo)) {
        throw new Error('Campo "tipo" inválido');
      }

      // INTEGRAÇÃO OPEN FOOD FACTS
      if (analysis.tipo === 'produto_embalado' && (analysis.marca_sugerida || analysis.produto_sugerido)) {
        const query = `${analysis.marca_sugerida || ''} ${analysis.produto_sugerido || ''}`.trim();
        
        if (query.length > 2) {
          console.log('🔍 Buscando Open Food Facts:', query);
          const produtos = await searchProduct(query);

          if (produtos.length > 0) {
            const offData = extractNutritionData(produtos[0]);
            console.log('✅ Produto encontrado:', offData.nome);

            const diffCalorias = Math.abs(analysis.calorias - offData.calorias) / analysis.calorias;

            if (diffCalorias > 0.2) {
              analysis.calorias = Math.round(offData.calorias);
              analysis.proteinas_g = Math.round(offData.proteinas);
              analysis.hidratos_g = Math.round(offData.hidratos);
              analysis.gorduras_g = Math.round(offData.gorduras);
              analysis.fonte_dados = 'openfoodfacts';
            } else {
              analysis.fonte_dados = 'ia_validada';
            }

            analysis.produto_oficial = {
              nome: offData.nome,
              marca: offData.marca,
              codigoBarras: offData.codigoBarras
            };
          } else {
            analysis.fonte_dados = 'ia_estimativa';
          }
        }
      } else {
        analysis.fonte_dados = 'ia_estimativa';
      }

      // AJUSTE POR PORÇÃO
      if (analysis.tipo === 'prato_cozinhado' && multiplier !== 1.0) {
        analysis.calorias = Math.round(analysis.calorias * multiplier);
        analysis.proteinas_g = Math.round(analysis.proteinas_g * multiplier);
        analysis.hidratos_g = Math.round(analysis.hidratos_g * multiplier);
        analysis.gorduras_g = Math.round(analysis.gorduras_g * multiplier);
      }

      // VALIDAÇÃO DE COERÊNCIA CALÓRICA
      const calculatedCalories =
        (analysis.proteinas_g || 0) * 4 +
        (analysis.hidratos_g || 0) * 4 +
        (analysis.gorduras_g || 0) * 9;

      const calorieDiffPercent = Math.abs(analysis.calorias - calculatedCalories) / analysis.calorias * 100;

      if (calorieDiffPercent > 15) {
        analysis.calorias = Math.round(calculatedCalories);
      }

      // Campos padrão
      analysis.confianca = Math.max(1, Math.min(5, Math.round(analysis.confianca || 3)));
      analysis.sugestao = analysis.sugestao || 'Mantém uma alimentação equilibrada.';
      analysis.marca_sugerida = analysis.marca_sugerida || null;
      analysis.produto_sugerido = analysis.produto_sugerido || null;
      analysis.ingredientes = analysis.ingredientes || [];
      analysis.porcao = portionLabel;

      // 🔒 GUARDA NO CACHE
      global.__nutriCache[cacheKey] = analysis;
      console.log('💾 Resultado guardado em cache');

    } catch (parseError) {
      console.error('❌ Erro:', parseError.message);
      analysis = {
        descricao: 'Não consegui identificar bem. Tenta foto mais nítida.',
        ingredientes: [],
        calorias: 0,
        proteinas_g: 0,
        hidratos_g: 0,
        gorduras_g: 0,
        confianca: 1,
        sugestao: 'Tira foto com melhor iluminação.',
        tipo: 'prato_cozinhado',
        fonte_dados: 'ia_estimativa',
        marca_sugerida: null,
        produto_sugerido: null,
        porcao: portionLabel
      };
    }

    return res.status(200).json({ analysis });

  } catch (error) {
    console.error(' Erro /api/analyze:', error);
    return res.status(500).json({ error: 'Erro na análise. Tenta novamente.' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};
