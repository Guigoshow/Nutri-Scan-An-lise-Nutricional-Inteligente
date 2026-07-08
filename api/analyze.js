// Importa funções do Open Food Facts
import { searchProduct, extractNutritionData } from '../lib/openfoodfacts.js';

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

    // Prompt profissional otimizado para precisão
    const systemPrompt = `Analisas fotos de refeições com precisão nutricional profissional.

METODOLOGIA OBRIGATÓRIA:
1. Identifica CADA ingrediente visível separadamente
2. Estima o peso de cada ingrediente em gramas (considera tamanho do prato ~25-28cm diâmetro)
3. Calcula nutrientes baseado nos pesos estimados
4. Considera o método de confeção visível (grelhado, cozido, frito, assado)
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
  - Manteiga: 10g = 75 kcal

✓ VEGETAIS:
  - Brócolos/espinafres: ~35 kcal/100g
  - Cenouras: ~41 kcal/100g
  - Ervilhas: ~81 kcal/100g (mais calóricas)

NUNCA SUBESTIMES:
- Molhos e temperos (adicionam 50-200 kcal)
- Azeite/óleo de confeção (adiciona 90-180 kcal)
- Queijo (adiciona 100-150 kcal)
- Frutos secos (30g = ~180 kcal)

IDENTIFICAÇÃO DE PRODUTOS EMBALADOS:
- Se vês marca/nome exato, indica em "marca_sugerida" e "produto_sugerido"
- Exemplo: "Danone Activia", "Nestlé Fitness"

FORMATO JSON ESTRITO (sem markdown, sem texto extra):
{
  "tipo": "produto_embalado" | "prato_cozinhado",
  "descricao": "descrição clara e completa (máximo 2 frases)",
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
  "sugestao": "sugestão prática para próxima refeição"
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
  "marca_sugerida": null,
  "produto_sugerido": null,
  "calorias": 543,
  "proteinas_g": 52,
  "hidratos_g": 62,
  "gorduras_g": 8,
  "confianca": 4,
  "sugestao": "Refeição equilibrada. Na próxima, adiciona mais vegetais variados."
}

EXEMPLO PRODUTO EMBALADO:
{
  "tipo": "produto_embalado",
  "descricao": "Iogurte líquido natural",
  "ingredientes": [],
  "marca_sugerida": "Danone",
  "produto_sugerido": "Activia Natural",
  "calorias": 60,
  "proteinas_g": 4,
  "hidratos_g": 10,
  "gorduras_g": 0,
  "confianca": 5,
  "sugestao": "Boa escolha! Adiciona fruta fresca para mais fibra."
}`;

    // Primeira análise
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        reasoning_effort: 'none',
        temperature: 0.2, // Mais preciso com temperatura baixa
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
                text: `Analisa esta foto (porção ${portionLabel}) e devolve JSON seguindo a metodologia.`,
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
      console.error('Erro Groq:', JSON.stringify(groqData));
      return res.status(502).json({ error: 'Erro na análise. Tenta novamente.' });
    }

    let analysisText = groqData.choices?.[0]?.message?.content?.trim() || '';
    analysisText = analysisText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    let analysis;
    try {
      analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(analysisText);

      // Validação de campos obrigatórios
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

      // INTEGRAÇÃO OPEN FOOD FACTS (apenas para produtos embalados)
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
              console.log(`📊 Ajustando valores OFF: diferença ${(diffCalorias * 100).toFixed(1)}%`);
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
            analysis.fonte_dados = 'ia_estimativa';
          }
        }
      } else {
        analysis.fonte_dados = 'ia_estimativa';
      }

      // AJUSTE POR TAMANHO DE PORÇÃO (apenas pratos cozinhados)
      if (analysis.tipo === 'prato_cozinhado' && multiplier !== 1.0) {
        console.log(` Ajustando para porção ${portion} (x${multiplier})`);
        analysis.calorias = Math.round(analysis.calorias * multiplier);
        analysis.proteinas_g = Math.round(analysis.proteinas_g * multiplier);
        analysis.hidratos_g = Math.round(analysis.hidratos_g * multiplier);
        analysis.gorduras_g = Math.round(analysis.gorduras_g * multiplier);
      }

      // VALIDAÇÃO DE COERÊNCIA CALÓRICA (margem 15%)
      const calculatedCalories =
        (analysis.proteinas_g || 0) * 4 +
        (analysis.hidratos_g || 0) * 4 +
        (analysis.gorduras_g || 0) * 9;

      const calorieDiffPercent = Math.abs(analysis.calorias - calculatedCalories) / analysis.calorias * 100;

      if (calorieDiffPercent > 15) {
        console.warn(`⚠️ Incoerência calórica ${calorieDiffPercent.toFixed(1)}%. Ajustando...`);
        analysis.calorias = Math.round(calculatedCalories);
      }

      // Campos padrão
      analysis.confianca = Math.max(1, Math.min(5, Math.round(analysis.confianca || 3)));
      analysis.sugestao = analysis.sugestao || 'Mantém uma alimentação equilibrada.';
      analysis.marca_sugerida = analysis.marca_sugerida || null;
      analysis.produto_sugerido = analysis.produto_sugerido || null;
      analysis.ingredientes = analysis.ingredientes || [];
      analysis.porcao = portionLabel;

    } catch (parseError) {
      console.error('❌ Erro parse JSON:', parseError.message);
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
    console.error('❌ Erro /api/analyze:', error);
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
