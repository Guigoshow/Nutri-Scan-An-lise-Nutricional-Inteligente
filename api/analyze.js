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

    // Validação de segurança: limita o tamanho do payload
    if (imageBase64.length > 5000000) { // ~3.5MB em base64
      return res.status(413).json({ error: 'Imagem demasiado grande. Usa uma foto mais pequena.' });
    }

    const dataUri = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

    // Multiplicadores baseados no tamanho da porção
    const portionMultipliers = {
      'pequena': 0.7,  // Reduz 30%
      'media': 1.0,    // Padrão
      'grande': 1.4    // Aumenta 40%
    };

    const multiplier = portionMultipliers[portion] || 1.0;
    const portionLabel = {
      'pequena': 'pequena',
      'media': 'média',
      'grande': 'grande'
    }[portion] || 'média';

    // Prompt melhorado com contexto de porção
    const systemPrompt = `Analisas fotos de refeições e devolves informações em formato JSON.

CONTEXTO IMPORTANTE: O utilizador indicou que esta é uma porção ${portionLabel}.
Ajusta as quantidades estimadas de acordo:
- Porção pequena: quantidades típicas de uma refeição ligeira
- Porção média: quantidades padrão de uma refeição normal
- Porção grande: quantidades generosas de uma refeição completa

Regras obrigatórias:
- Identifica se é "produto_embalado" (iogurte, bolachas, sumo, barra energética, leite, cereais) ou "prato_cozinhado" (pizza, salada, arroz, sopa, carne, peixe, sandes caseira)
- Para produtos embalados: tenta identificar marca e nome exato do produto
- Para pratos cozinhados: descreve os ingredientes visíveis de forma clara
- Baseia-te apenas no que é visível na imagem. Usa "parece conter" ou "provavelmente" quando não tiveres certeza.
- As estimativas devem ser coerentes: calorias = (proteína×4 + hidratos×4 + gordura×9)
- Para pratos com massa, queijo ou molhos, não subestimes as calorias
- Descrição em português de Portugal, concisa (máximo 2 frases)
- Números inteiros para calorias e gramas
- Confiança: 1-5 (1=muito incerto, 5=muito certo) baseado na qualidade da imagem
- Sugestão: recomendação prática para próxima refeição

A saída deve ser APENAS um objeto JSON válido, sem markdown, sem texto extra.
Formato exato:
{
  "tipo": "produto_embalado" | "prato_cozinhado",
  "descricao": "descrição clara do que está na imagem",
  "marca_sugerida": "nome da marca se for produto embalado e visível (ou null)",
  "produto_sugerido": "nome do produto se identificável (ou null)",
  "calorias": numero_inteiro,
  "proteinas_g": numero_inteiro,
  "hidratos_g": numero_inteiro,
  "gorduras_g": numero_inteiro,
  "confianca": numero_de_1_a_5,
  "sugestao": "sugestão curta para próxima refeição"
}

Exemplo produto embalado:
{
  "tipo": "produto_embalado",
  "descricao": "Iogurte líquido natural",
  "marca_sugerida": "Danone",
  "produto_sugerido": "Activia Bebê Natural",
  "calorias": 60,
  "proteinas_g": 4,
  "hidratos_g": 10,
  "gorduras_g": 0,
  "confianca": 5,
  "sugestao": "Boa escolha! Na próxima refeição, adiciona fruta fresca ou frutos secos."
}

Exemplo prato cozinhado:
{
  "tipo": "prato_cozinhado",
  "descricao": "Pizza inteira com molho de tomate, queijo mozzarella, rúcula e cebola roxa",
  "marca_sugerida": null,
  "produto_sugerido": null,
  "calorias": 1400,
  "proteinas_g": 50,
  "hidratos_g": 180,
  "gorduras_g": 50,
  "confianca": 4,
  "sugestao": "Na próxima refeição, privilegia proteína magra e vegetais, pois esta foi rica em hidratos e gorduras."
}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        reasoning_effort: 'none',
        temperature: 0.3,
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
                text: `Analisa esta foto (porção ${portionLabel}) e devolve apenas o JSON seguindo as regras.`,
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
      return res.status(502).json({ error: 'Não foi possível analisar a foto agora. Tenta novamente.' });
    }

    let analysisText = groqData.choices?.[0]?.message?.content?.trim() || '';

    // Rede de segurança: remove qualquer bloco de "pensamento"
    analysisText = analysisText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Tenta fazer parse do JSON
    let analysis;
    try {
      // Remove possíveis markdown blocks
      analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(analysisText);

      // Validação completa dos campos obrigatórios
      const requiredFields = ['descricao', 'calorias', 'proteinas_g', 'hidratos_g', 'gorduras_g', 'tipo'];
      const missingFields = requiredFields.filter(field => !(field in analysis));

      if (missingFields.length > 0) {
        throw new Error(`Campos em falta: ${missingFields.join(', ')}`);
      }

      // Validação de tipos
      if (typeof analysis.descricao !== 'string') {
        throw new Error('Campo "descricao" deve ser texto');
      }
      if (typeof analysis.calorias !== 'number' || analysis.calories < 0) {
        throw new Error('Campo "calorias" deve ser número positivo');
      }
      if (!['produto_embalado', 'prato_cozinhado'].includes(analysis.tipo)) {
        throw new Error('Campo "tipo" deve ser "produto_embalado" ou "prato_cozinhado"');
      }

      // 🔥 INTEGRAÇÃO OPEN FOOD FACTS
      let openFoodFactsData = null;

      if (analysis.tipo === 'produto_embalado' && (analysis.marca_sugerida || analysis.produto_sugerido)) {
        // Busca no Open Food Facts
        const query = `${analysis.marca_sugerida || ''} ${analysis.produto_sugerido || ''}`.trim();
        
        if (query.length > 2) {
          console.log('🔍 Buscando no Open Food Facts:', query);
          const produtos = await searchProduct(query);

          if (produtos.length > 0) {
            openFoodFactsData = extractNutritionData(produtos[0]);
            console.log('✅ Produto encontrado:', openFoodFactsData.nome);

            // Compara e ajusta se necessário (margem 20%)
            const diffCalorias = Math.abs(analysis.calorias - openFoodFactsData.calorias) / analysis.calorias;

            if (diffCalorias > 0.2) {
              // Ajusta para os valores do Open Food Facts (mais precisos)
              console.log(`📊 Ajustando valores: diferença de ${(diffCalorias * 100).toFixed(1)}%`);
              analysis.calorias = Math.round(openFoodFactsData.calorias);
              analysis.proteinas_g = Math.round(openFoodFactsData.proteinas);
              analysis.hidratos_g = Math.round(openFoodFactsData.hidratos);
              analysis.gorduras_g = Math.round(openFoodFactsData.gorduras);
              analysis.fonte_dados = 'openfoodfacts';
            } else {
              console.log('✓ Valores da IA validados pelo Open Food Facts');
              analysis.fonte_dados = 'ia_validada';
            }

            analysis.produto_oficial = {
              nome: openFoodFactsData.nome,
              marca: openFoodFactsData.marca,
              codigoBarras: openFoodFactsData.codigoBarras
            };
          } else {
            console.log('⚠️ Produto não encontrado no Open Food Facts');
            analysis.fonte_dados = 'ia_estimativa';
          }
        } else {
          analysis.fonte_dados = 'ia_estimativa';
        }
      } else {
        analysis.fonte_dados = 'ia_estimativa';
      }

      // Ajusta valores baseado no tamanho da porção (apenas para pratos cozinhados)
      if (analysis.tipo === 'prato_cozinhado' && multiplier !== 1.0) {
        console.log(`📏 Ajustando para porção ${portionLabel} (multiplicador: ${multiplier})`);
        analysis.calorias = Math.round(analysis.calorias * multiplier);
        analysis.proteinas_g = Math.round(analysis.proteinas_g * multiplier);
        analysis.hidratos_g = Math.round(analysis.hidratos_g * multiplier);
        analysis.gorduras_g = Math.round(analysis.gorduras_g * multiplier);
      }

      // Validação de coerência calórica (margem de 15%)
      const calculatedCalories =
        (analysis.proteinas_g || 0) * 4 +
        (analysis.hidratos_g || 0) * 4 +
        (analysis.gorduras_g || 0) * 9;

      const calorieDiff = Math.abs(analysis.calorias - calculatedCalories);
      const calorieDiffPercent = (calorieDiff / analysis.calorias) * 100;

      if (calorieDiffPercent > 15) {
        console.warn(`⚠️ Incoerência calórica de ${calorieDiffPercent.toFixed(1)}%. Ajustando...`);
        analysis.calories = Math.round(calculatedCalories);
      }

      // Define campos padrão se não existirem
      if (!analysis.confianca || typeof analysis.confianca !== 'number') {
        analysis.confianca = 3;
      }
      analysis.confianca = Math.max(1, Math.min(5, Math.round(analysis.confianca)));

      if (!analysis.sugestao || typeof analysis.sugestao !== 'string') {
        analysis.sugestao = 'Mantém uma alimentação equilibrada ao longo do dia.';
      }

      if (!analysis.marca_sugerida) {
        analysis.marca_sugerida = null;
      }
      if (!analysis.produto_sugerido) {
        analysis.produto_sugerido = null;
      }

      // Adiciona informação da porção
      analysis.porcao = portionLabel;

    } catch (parseError) {
      console.error('❌ Erro ao fazer parse do JSON:', parseError.message, '| Conteúdo:', analysisText);
      // Fallback se a IA não devolver JSON válido
      analysis = {
        descricao: 'Não consegui identificar bem a comida. Tenta uma foto mais nítida e com boa luz.',
        calorias: 0,
        proteinas_g: 0,
        hidratos_g: 0,
        gorduras_g: 0,
        confianca: 1,
        sugestao: 'Tira uma foto com melhor iluminação e enquadramento para uma análise mais precisa.',
        tipo: 'prato_cozinhado',
        fonte_dados: 'ia_estimativa',
        marca_sugerida: null,
        produto_sugerido: null,
        porcao: portionLabel
      };
    }

    return res.status(200).json({ analysis });

  } catch (error) {
    console.error('❌ Erro no /api/analyze:', error);
    return res.status(500).json({ error: 'Ocorreu um erro a analisar a foto. Tenta novamente.' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};
