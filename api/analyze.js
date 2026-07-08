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

    const systemPrompt = `Analisas fotos de refeições e devolves uma estimativa nutricional.

Regras obrigatórias:
- Nunca reveles o teu raciocínio interno. A resposta deve conter apenas o resultado final para o utilizador, sem tags de pensamento nem processo intermédio.
- Baseia-te apenas no que é visível na imagem. Quando não tiveres a certeza de um ingrediente, usa expressões como "parece conter" ou "provavelmente". Não inventes ingredientes que não sejam claramente visíveis.
- As estimativas devem ser coerentes: as calorias devem corresponder aproximadamente aos macronutrientes (4 kcal/g para proteína e hidratos de carbono, 9 kcal/g para gordura).
- Para pratos com massa, queijo ou molhos (ex: pizzas inteiras), não subestimes as calorias — considera o tamanho aparente, a espessura, a quantidade de queijo e o azeite/gordura visível.
- Resposta em português de Portugal, texto simples, sem markdown, sem asteriscos, máximo 5 linhas.
- A saída deve conter apenas: descrição da refeição; calorias estimadas; proteínas, hidratos de carbono e gorduras estimados. Nada mais — sem introduções, sem avisos, sem despedidas.`;

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
                text: 'Analisa esta foto de uma refeição, seguindo à risca as regras do sistema.',
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
      groqData.choices?.[0]?.message?.content?.trim() ||
      'Não consegui identificar bem a comida. Tenta uma foto mais nítida e com boa luz.';

    // Rede de segurança: remove qualquer bloco de "pensamento" que o modelo possa ter deixado escapar
    analysisText = analysisText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

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
