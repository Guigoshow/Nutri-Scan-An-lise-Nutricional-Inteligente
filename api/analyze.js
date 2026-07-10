import { searchProduct, extractNutritionData } from '../lib/openfoodfacts.js';
import { createHash } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { imageBase64, mimeType, portion = 'media' } = req.body;

    // Validação robusta
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Nenhuma imagem recebida.' });
    }

    if (imageBase64.length > 5000000) {
      return res.status(413).json({ error: 'Imagem demasiado grande.' });
    }

    // Validação de porção
    const validPortions = ['pequena', 'media', 'grande'];
    if (!validPortions.includes(portion)) {
      return res.status(400).json({ error: 'Porção inválida.' });
    }

    // 🔒 CACHE: Hash da imagem + porção para consistência
    const imageHash = createHash('sha256')
      .update(imageBase64.slice(0, 5000) + portion)
      .digest('hex');

    const cacheKey = `analysis_${imageHash}`;
    if (!global.__nutriCache) global.__nutriCache = {};
    
    if (global.__nutriCache[cacheKey]) {
      console.log('✅ Resultado em cache');
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

    const multiplier = portionMultipliers[portion];
    const portionLabel = {
      'pequena': 'pequena (reduz ~30%)',
      'media': 'média (quantidade padrão)',
      'grande': 'grande (aumenta ~40%)'
    }[portion];

    // 🎯 PROMPT PROFISSIONAL COMPLETO E OTIMIZADO
    const systemPrompt = `Analisas fotos de refeições com precisão nutricional profissional.

METODOLOGIA OBRIGATÓRIA:
1. Identifica CADA ingrediente visível separadamente
2. Estima o peso de cada ingrediente em gramas (prato padrão ~25-28cm diâmetro)
3. Calcula nutrientes baseado nos pesos
4. Considera método de confeção visível (grelhado, cozido, frito, assado, cru)
5. Valida coerência: calorias = (proteína×4 + hidratos×4 + gordura×9)

CONTEXTO DA PORÇÃO: ${portionLabel}

REGRAS CRÍTICAS DE PRECISÃO:

✓ PROTEÍNAS (carne/peixe):
  - 100g cru = ~75g cozinhado (perde 25% água)
  - Peito de frango grelhado: 165 kcal/100g, 31g prot
  - Carne de vaca grelhada: 250 kcal/100g, 26g prot
  - Peixe branco grelhado: 120 kcal/100g, 22g prot
  - Salmão grelhado: 208 kcal/100g, 20g prot
  - Atum: 144 kcal/100g, 30g prot
  - Porco: 242 kcal/100g, 27g prot
  - Ovos (1 unidade ~50g): 72 kcal, 6g prot

✓ HIDRATOS (arroz/massa/batata):
  - 100g cru = ~300g cozinhado (absorve água)
  - Arroz branco cozinhado: 130 kcal/100g, 28g hidr
  - Arroz integral cozinhado: 123 kcal/100g, 26g hidr
  - Massa cozinhada: 160 kcal/100g, 31g hidr
  - Batata cozida: 87 kcal/100g, 20g hidr
  - Batata frita: 312 kcal/100g, 41g hidr
  - Pão (1 fatia ~30g): 80 kcal, 15g hidr
  - Batata-doce: 86 kcal/100g, 20g hidr

✓ GORDURAS VISÍVEIS:
  - 1 colher sopa azeite = 10g = 90 kcal
  - Molhos cremosos: 50-150 kcal
  - Queijo ralado: 30g = ~120 kcal
  - Manteiga: 10g = 75 kcal
  - Abacate: 160 kcal/100g
  - Frutos secos (30g): ~180 kcal
  - Azeitonas (10 unidades): ~50 kcal

✓ VEGETAIS:
  - Brócolos/espinafres: ~35 kcal/100g
  - Cenouras: ~41 kcal/100g
  - Ervilhas: ~81 kcal/100g
  - Tomate: ~18 kcal/100g
  - Alface: ~15 kcal/100g
  - Pepino: ~16 kcal/100g
  - Pimento: ~31 kcal/100g
  - Cebola: ~40 kcal/100g

✓ FRUTAS:
  - Maçã: ~52 kcal/100g
  - Banana: ~89 kcal/100g
  - Laranja: ~47 kcal/100g
  - Morangos: ~32 kcal/100g
  - Uvas: ~69 kcal/100g

✓ BEBIDAS:
  - Sumo natural (200ml): ~80-100 kcal
  - Refrigerante (330ml): ~140 kcal
  - Cerveja (330ml): ~140 kcal
  - Vinho (150ml): ~120 kcal
  - Água: 0 kcal

NUNCA SUBESTIMES:
- Molhos e temperos (50-200 kcal)
- Azeite/óleo de confeção (90-180 kcal)
- Queijo (100-150 kcal)
- Frutos secos (30g = ~180 kcal)
- Fruta seca (30g = ~90 kcal)
- Bebidas calóricas (100-200 kcal)

DETEÇÃO DE ALERGÉNIOS:
- Glúten: pão, massa, bolachas, cerveja
- Lactose: leite, queijo, iogurte, manteiga
- Frutos secos: amêndoas, nozes, amendoins
- Marisco: camarão, amêijoas, mexilhão
- Soja: tofu, molho de soja
- Ovos: omeletes, bolos

IDENTIFICAÇÃO DE PRODUTOS EMBALADOS:
- Se vês marca/nome exato, indica em "marca_sugerida" e "produto_sugerido"
- Exemplo: "Danone Activia", "Nestlé Fitness", "Compal"

FORMATO JSON ESTRITO (sem markdown, sem texto extra):
{
  "tipo": "produto_embalado" | "prato_cozinhado",
  "descricao": "descrição clara e completa (máximo 2 frases)",
  "ingredientes": [
    {"nome": "ingrediente", "peso_g": numero, "calorias": numero}
  ],
  "alergenios": ["gluten", "lactose", "frutos_secos", "marisco", "soja", "ovos"] ou [],
  "marca_sugerida": "marca ou null",
  "produto_sugerido": "nome do produto ou null",
  "calorias": numero_inteiro,
  "proteinas_g": numero_inteiro,
  "hidratos_g": numero_inteiro,
  "gorduras_g": numero_inteiro,
  "confianca": 1-5,
  "sugestao": "sugestão prática e contextualizada para próxima refeição"
}

EXEMPLO PRATO COZINHADO:
{
  "tipo": "prato_cozinhado",
  "descricao": "Peito de frango grelhado com arroz branco e brócolos cozidos",
  "ingredientes": [
    {"nome": "frango grelhado", "peso_g": 150, "calorias": 248},
    {"nome": "arroz branco", "peso_g": 200, "calorias": 260},
    {"nome": "brócolos", "peso_g": 100, "calorias": 35}
  ],
  "alergenios": [],
  "marca_sugerida": null,
  "produto_sugerido": null,
  "calorias": 543,
  "proteinas_g": 52,
  "hidratos_g": 62,
  "gorduras_g": 8,
  "confianca": 4,
  "sugestao": "Refeição equilibrada. Na próxima, adiciona mais vegetais variados e uma fonte de gordura saudável como azeite."
}

EXEMPLO PRODUTO EMBALADO:
{
  "tipo": "produto_embalado",
  "descricao": "Iogurte líquido natural Danone Activia",
  "ingredientes": [],
  "alergenios": ["lactose"],
  "marca_sugerida": "Danone",
  "produto_sugerido": "Activia Natural",
  "calorias": 60,
  "proteinas_g": 4,
  "hidratos_g": 10,
  "gorduras_g": 0,
  "confianca": 5,
  "sugestao": "Boa escolha! Adiciona fruta fresca para mais fibra e vitaminas."
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
          temperature: 0,
          seed: 42,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: `Analisa esta foto (porção ${portionLabel}) e devolve JSON.` },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ],
        }),
      });

      const groqData = await groqResponse.json();
      if (!groqResponse.ok) throw new Error('Erro Groq');

      let text = groqData.choices?.[0]?.message?.content?.trim() || '';
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      return JSON.parse(text);
    }

    // 🎯 CONSENSO: 3 análises + média com deteção de outliers
    async function analyzeWithConsensus() {
      const promises = [analyzeOnce(), analyzeOnce(), analyzeOnce()];
      const settled = await Promise.allSettled(promises);
      
      let results = settled
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

      if (results.length === 0) throw new Error('Todas as análises falharam');

      // Deteção de outliers (descartar valores muito diferentes da média)
      if (results.length >= 3) {
        const avgCalorias = results.reduce((sum, r) => sum + (r.calorias || 0), 0) / results.length;
        const threshold = avgCalorias * 0.3; // 30% de tolerância
        
        results = results.filter(r => {
          const diff = Math.abs((r.calorias || 0) - avgCalorias);
          return diff <= threshold;
        });

        if (results.length === 0) {
          // Se todos foram descartados, usa todos
          results = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
        }
      }

      // Média dos valores numéricos
      const avg = (key) => Math.round(
        results.reduce((sum, r) => sum + (r[key] || 0), 0) / results.length
      );

      // Combina alergénios de todas as análises
      const allAlergenios = new Set();
      results.forEach(r => {
        if (Array.isArray(r.alergenios)) {
          r.alergenios.forEach(a => allAlergenios.add(a));
        }
      });

      return {
        tipo: results[0].tipo || 'prato_cozinhado',
        descricao: results[0].descricao || '',
        ingredientes: results[0].ingredientes || [],
        alergenios: Array.from(allAlergenios),
        marca_sugerida: results[0].marca_sugerida || null,
        produto_sugerido: results[0].produto_sugerido || null,
        calorias: avg('calorias'),
        proteinas_g: avg('proteinas_g'),
        hidratos_g: avg('hidratos_g'),
        gorduras_g: avg('gorduras_g'),
        confianca: avg('confianca'),
        sugestao: results[0].sugestao || ''
      };
    }

    let analysis;
    try {
      analysis = await analyzeWithConsensus();

      // Validação de campos
      const required = ['descricao', 'calorias', 'proteinas_g', 'hidratos_g', 'gorduras_g', 'tipo'];
      const missing = required.filter(f => !(f in analysis));
      if (missing.length > 0) throw new Error(`Campos em falta: ${missing.join(', ')}`);

      // Validação de tipos
      if (typeof analysis.descricao !== 'string') throw new Error('Descrição inválida');
      if (typeof analysis.calorias !== 'number' || analysis.calorias < 0) throw new Error('Calorias inválidas');
      if (!['produto_embalado', 'prato_cozinhado'].includes(analysis.tipo)) throw new Error('Tipo inválido');

      // INTEGRAÇÃO OPEN FOOD FACTS (com múltiplas tentativas)
      if (analysis.tipo === 'produto_embalado' && (analysis.marca_sugerida || analysis.produto_sugerido)) {
        const queries = [
          `${analysis.marca_sugerida || ''} ${analysis.produto_sugerido || ''}`.trim(),
          analysis.produto_sugerido || '',
          analysis.marca_sugerida || ''
        ].filter(q => q.length > 2);

        let offData = null;
        
        for (const query of queries) {
          console.log('🔍 Buscando Open Food Facts:', query);
          const produtos = await searchProduct(query);
          
          if (produtos.length > 0) {
            offData = extractNutritionData(produtos[0]);
            console.log('✅ Produto encontrado:', offData.nome);
            break;
          }
        }
        
        if (offData) {
          const diff = Math.abs(analysis.calorias - offData.calorias) / analysis.calorias;

          if (diff > 0.2) {
            console.log(`📊 Ajustando valores OFF: diferença ${(diff * 100).toFixed(1)}%`);
            analysis.calorias = Math.round(offData.calorias);
            analysis.proteinas_g = Math.round(offData.proteinas);
            analysis.hidratos_g = Math.round(offData.hidratos);
            analysis.gorduras_g = Math.round(offData.gorduras);
            analysis.fonte_dados = 'openfoodfacts';
          } else {
            console.log('✓ Valores IA validados por OFF');
            analysis.fonte_dados = 'ia_validada';
          }

          analysis.produto_oficial = {
            nome: offData.nome,
            marca: offData.marca,
            codigoBarras: offData.codigoBarras
          };
        } else {
          console.log('⚠️ Produto não encontrado no OFF');
          analysis.fonte_dados = 'ia_estimativa';
        }
      } else {
        analysis.fonte_dados = 'ia_estimativa';
      }

      // AJUSTE POR PORÇÃO
      if (analysis.tipo === 'prato_cozinhado' && multiplier !== 1.0) {
        console.log(`📏 Ajustando para porção ${portion} (x${multiplier})`);
        analysis.calorias = Math.round(analysis.calorias * multiplier);
        analysis.proteinas_g = Math.round(analysis.proteinas_g * multiplier);
        analysis.hidratos_g = Math.round(analysis.hidratos_g * multiplier);
        analysis.gorduras_g = Math.round(analysis.gorduras_g * multiplier);
      }

      // VALIDAÇÃO DE COERÊNCIA CALÓRICA (mais rigorosa)
      const calcCal = (analysis.proteinas_g || 0) * 4 + 
                      (analysis.hidratos_g || 0) * 4 + 
                      (analysis.gorduras_g || 0) * 9;
      
      const diffPct = Math.abs(analysis.calorias - calcCal) / analysis.calorias * 100;
      if (diffPct > 10) { // Reduzido de 15% para 10%
        console.warn(`⚠️ Incoerência calórica ${diffPct.toFixed(1)}%. Ajustando...`);
        analysis.calorias = Math.round(calcCal);
      }

      // Campos padrão
      analysis.confianca = Math.max(1, Math.min(5, Math.round(analysis.confianca || 3)));
      analysis.sugestao = analysis.sugestao || 'Mantém uma alimentação equilibrada ao longo do dia.';
      analysis.marca_sugerida = analysis.marca_sugerida || null;
      analysis.produto_sugerido = analysis.produto_sugerido || null;
      analysis.alergenios = Array.isArray(analysis.alergenios) ? analysis.alergenios : [];
      analysis.ingredientes = Array.isArray(analysis.ingredientes) ? analysis.ingredientes : [];
      analysis.porcao = portionLabel;

      // 🔒 GUARDAR EM CACHE
      global.__nutriCache[cacheKey] = analysis;
      console.log('💾 Resultado guardado em cache');

    } catch (err) {
      console.error('❌ Erro:', err.message);
      analysis = {
        descricao: 'Não consegui identificar. Tenta foto mais nítida.',
        ingredientes: [],
        alergenios: [],
        calorias: 0,
        proteinas_g: 0,
        hidratos_g: 0,
        gorduras_g: 0,
        confianca: 1,
        sugestao: 'Tira foto com melhor iluminação e enquadramento.',
        tipo: 'prato_cozinhado',
        fonte_dados: 'ia_estimativa',
        marca_sugerida: null,
        produto_sugerido: null,
        porcao: portionLabel
      };
    }

    return res.status(200).json({ analysis });

  } catch (error) {
    console.error('❌ Erro /api/analyze:', error);
    return res.status(500).json({ error: 'Erro na análise.' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
