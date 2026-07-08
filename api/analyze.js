export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Nenhuma imagem recebida.' });
    }

    // Validação de segurança: limita o tamanho do payload
    if (imageBase64.length > 5000000) { // ~3.5MB em base64
      return res.status(413).json({ error: 'Imagem demasiado grande. Usa uma foto mais pequena.' });
    }

    const dataUri = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

    const systemPrompt = `Analisas fotos de refeições e devolves uma estimativa nutricional em formato JSON.

Regras obrigatórias:
- Baseia-te apenas no que é visível na imagem. Quando não tiveres a certeza de um ingrediente, usa expressões como "parece conter" ou "provavelmente" na descrição.
- As estimativas devem ser coerentes: as calorias devem corresponder aproximadamente aos macronutrientes (4 kcal/g para proteína e hidratos de carbono, 9 kcal/g para gordura).
- Para pratos com massa, queijo ou molhos (ex: pizzas inteiras), não subestimes as calorias — considera o tamanho aparente, a espessura, a quantidade de queijo e o azeite/gordura visível.
- Descrição em português de Portugal, concisa (máximo 1 frase).
- Números inteiros para calorias e gramas.

A saída deve ser APENAS um objeto JSON válido, sem markdown, sem \`\`\`json, sem texto extra.
Formato exato:
{
  "descricao": "descrição curta da refeição",
  "calorias": numero_inteiro,
  "proteinas_g": numero_inteiro,
  "hidratos_g": numero_inteiro,
  "gorduras_g": numero_inteiro
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
                text: 'Analisa esta foto de uma refeição e devolve apenas o JSON seguindo à risca as regras do sistema.',
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

    let analysisText =
      groqData.choices?.[0]?.message?.content?.trim() || '';

    // Rede de segurança: remove qualquer bloco de "pensamento" que o modelo possa ter deixado escapar
    analysisText = analysisText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Tenta fazer parse do JSON
    let analysis;
    try {
      // Remove possíveis markdown blocks se a IA os adicionar
      analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(analysisText);
      
      // Validação básica dos campos
      if (!analysis.descricao || typeof analysis.calorias !== 'number') {
        throw new Error('JSON inválido');
      }
    } catch (parseError) {
      console.error('Erro ao fazer parse do JSON:', analysisText);
      // Fallback se a IA não devolver JSON válido
      analysis = {
        descricao: 'Não consegui identificar bem a comida. Tenta uma foto mais nítida e com boa luz.',
        calorias: 0,
        proteinas_g: 0,
        hidratos_g: 0,
        gorduras_g: 0
      };
    }

    return res.status(200).json({ analysis });
  } catch (error) {
    console.error('Erro no /api/analyze:', error);
    return res.status(500).json({ error: 'Ocorreu um erro a analisar a foto. Tenta novamente.' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb', // Reduzido porque o frontend comprime as imagens
    },
  },
};
