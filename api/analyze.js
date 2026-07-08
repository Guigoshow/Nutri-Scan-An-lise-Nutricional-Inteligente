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

    // Validação de segurança
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
      'pequena': 'pequena',
      'media': 'média',
      'grande': 'grande'
    }[portion] || 'média';

    // Prompt otimizado
    const systemPrompt = `Analisas fotos de refeições e devolves informações nutricionais em JSON.

CONTEXTO: O utilizador indicou que esta é uma porção ${portionLabel}.
Ajusta as quantidades em conformidade.

REGRAS OBRIGATÓRIAS:
1. Identifica se é "produto_embalado" ou "prato_cozinhado"
2. Para produtos embalados: identifica MARCA e NOME exato
3. Para pratos cozinhados: descreve ingredientes visíveis
4. Usa "parece conter" quando não tiveres certeza
5. Coerência calórica: calorias = (proteína×4 + hidratos×4 + gordura×9)
6. Não subestimes pratos com massa, queijo ou molhos
7. Descrição em português de Portugal (máximo 2 frases)
8. Números inteiros para calorias e gramas
9. Confiança: 1-5 baseado na qualidade da imagem
10. Sugestão prática para próxima refeição

FORMATO JSON EXATO (sem markdown, sem texto extra):
{
  "tipo": "produto_embalado" | "prato_cozinhado",
  "descricao": "descrição clara",
  "marca_sugerida": "marca ou null",
  "produto_sugerido": "nome do produto ou null",
  "calorias": numero_inteiro,
  "proteinas_g": numero_inteiro,
  "hidratos_g": numero_inteiro,
  "gorduras_g": numero_inteiro,
  "confianca": 1-5,
  "sugestao": "sugestão curta"
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
      console.error('Erro Groq:', JSON.stringify(groqData));
      return res.status(502).json({ error: 'Erro na análise. Tenta novamente.' });
    }

    let analysisText = groqData.choices?.[0]?.message?.content?.trim() || '';
    analysisText = analysisText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    let analysis;
    try {
      analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(analysisText);

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
              console.log(`📊 Ajustando valores: diferença ${(diffCalorias * 100).toFixed(1)}%`);
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

      // Ajuste por tamanho de porção (apenas pratos cozinhados)
      if (analysis.tipo === 'prato_cozinhado' && multiplier !== 1.0) {
        console.log(`📏 Ajustando para porção ${portionLabel} (x${multiplier})`);
        analysis.calorias = Math.round(analysis.calorias * multiplier);
        analysis.proteinas_g = Math.round(analysis.proteinas_g * multiplier);
        analysis.hidratos_g = Math.round(analysis.hidratos_g * multiplier);
        analysis.gorduras_g = Math.round(analysis.gorduras_g * multiplier);
      }

      // Validação de coerência calórica
      const calculatedCalories =
        (analysis.proteinas_g || 0) * 4 +
        (analysis.hidratos_g || 0) * 4 +
        (analysis.gorduras_g || 0) * 9;

      const calorieDiffPercent = Math.abs(analysis.calorias - calculatedCalories) / analysis.calorias * 100;

      if (calorieDiffPercent > 15) {
        console.warn(`️ Incoerência calórica ${calorieDiffPercent.toFixed(1)}%. Ajustando...`);
        analysis.calorias = Math.round(calculatedCalories);
      }

      // Campos padrão
      analysis.confianca = Math.max(1, Math.min(5, Math.round(analysis.confianca || 3)));
      analysis.sugestao = analysis.sugestao || 'Mantém uma alimentação equilibrada.';
      analysis.marca_sugerida = analysis.marca_sugerida || null;
      analysis.produto_sugerido = analysis.produto_sugerido || null;
      analysis.porcao = portionLabel;

    } catch (parseError) {
      console.error('❌ Erro parse JSON:', parseError.message);
      analysis = {
        descricao: 'Não consegui identificar bem. Tenta foto mais nítida.',
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
