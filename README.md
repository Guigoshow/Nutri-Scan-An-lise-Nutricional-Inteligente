# Nutri Scan — Protótipo Web

Site simples: envias uma foto de uma refeição, o Gemini analisa e devolve calorias/macros estimados.

## Estrutura

```
nutri-web/
├── public/
│   └── index.html      ← página com upload de foto
├── api/
│   └── analyze.js       ← função serverless que chama o Gemini
└── package.json
```

## Passo 1 — Obter a chave do Groq

1. Vai a [console.groq.com](https://console.groq.com)
2. Regista-te (email ou conta Google, sem cartão de crédito)
3. Vai a **API Keys** → **Create API Key**
4. Guarda essa chave

## Passo 2 — Deploy no Vercel

1. Cria um repositório no GitHub e faz push desta pasta (`nutri-web`)
2. Vai a [vercel.com](https://vercel.com) → **Add New Project** → importa o repositório
3. Não precisas de mudar nenhuma definição de build — o Vercel deteta automaticamente a pasta `public/` e `api/`
4. Antes do deploy (ou depois, em **Settings → Environment Variables**), adiciona:

   | Nome | Valor |
   |---|---|
   | `GROQ_API_KEY` | a chave que criaste no passo 1 |

5. Se adicionares a variável depois do primeiro deploy, faz **Redeploy** para ficar ativa.

## Passo 3 — Testar

1. Abre o URL que o Vercel te dá (ex: `https://o-teu-projeto.vercel.app`)
2. Escolhe ou tira uma foto de uma refeição
3. Clica em **Analisar refeição**
4. Em poucos segundos aparece a análise (o que identifica, calorias, macros)

## Testar localmente (opcional)

Se tiveres o Vercel CLI instalado (`npm i -g vercel`):

```bash
vercel dev
```

Isto corre o site e as funções localmente. Precisas de criar um ficheiro `.env.local` com:

```
GROQ_API_KEY=a_tua_chave_aqui
```

## Nota sobre o modelo

Este protótipo usa o **Qwen 3.6 27B** (via Groq), atualmente o modelo com visão disponível na Groq — está em preview (a Groq troca modelos de visão com frequência). Se no futuro este deixar de funcionar, confirma o modelo de visão atual em [console.groq.com/docs/vision](https://console.groq.com/docs/vision) e troca a linha `model:` no `api/analyze.js`. Se notares respostas inconsistentes, também podes trocar para um modelo mais maduro (ex: Gemini).

## Próximos passos (depois de validado)

- Cruzar os resultados da IA com a base de dados do **Open Food Facts** para maior precisão
- Guardar histórico de análises (precisa de base de dados — Supabase, por exemplo)
- Passar de site para WhatsApp (Twilio), quando quiseres testar a experiência real com um nutricionista
