export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Nenhuma imagem recebida.' });
    }

    const dataUri = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analisa esta foto de uma refeição. Responde em português de Portugal, em texto simples e curto (máximo 5 linhas, sem markdown, sem asteriscos), com: 1) o que identificas no prato, 2) estimativa de calorias, 3) estimativa de macros (proteína / carboidratos / gordura). Sê direto, sem introduções nem avisos.',
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

    const analysisText =
      groqData.choices?.[0]?.message?.content?.trim() ||
      'Não consegui identificar bem a comida. Tenta uma foto mais nítida e com boa luz.';

    return res.status(200).json({ analysis: analysisText });
  } catch (error) {
    console.error('Erro no /api/analyze:', error);
    return res.status(500).json({ error: 'Ocorreu um erro a analisar a foto. Tenta novamente.' });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
