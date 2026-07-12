# 🥗 Nutri Scan - Análise Nutricional Inteligente

![Nutri Scan](https://img.shields.io/badge/status-online-success)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![Supabase](https://img.shields.io/badge/Supabase-Auth-3ecf8e)
![Groq](https://img.shields.io/badge/Groq-AI-orange)

Aplicação web de análise nutricional que utiliza **inteligência artificial** para identificar alimentos através de fotos e códigos de barras, fornecendo informação detalhada sobre calorias, macronutrientes e alergénios.

## 🚀 Funcionalidades

### Análise Inteligente
- 📸 **Análise por foto**: Tira uma foto da refeição e a IA identifica automaticamente os alimentos
- 📊 **Scanner de código de barras**: Lê códigos de barras em tempo real ou a partir de imagem
- 🎯 **Estimativa precisa**: Cálculo de calorias, proteínas, hidratos e gorduras
- ⚠️ **Deteção de alergénios**: Identifica automaticamente alergénios presentes

### Gestão de Dados
- 👤 **Autenticação segura**: Sistema de login com Supabase Auth
- 📈 **Histórico pessoal**: Guarda todas as análises realizadas
- 🎯 **Objetivos diários**: Define metas calóricas e acompanha o progresso
- 📊 **Gráficos evolutivos**: Visualiza a evolução semanal de calorias e macros

### Integração com Bases de Dados
- ✅ **Open Food Facts**: Validação de produtos embalados com base de dados oficial
- 🤖 **IA Groq (Qwen 3.6)**: Análise avançada de imagens com modelo de última geração
- 🔒 **Consensus de 3 análises**: Validação cruzada para maior precisão

## 🛠️ Tecnologias

- **Frontend**: Next.js 14, React, HTML5, CSS3
- **Backend**: Next.js API Routes
- **Base de Dados**: Supabase (PostgreSQL)
- **Autenticação**: Supabase Auth
- **IA**: Groq API (Qwen 3.6 27B)
- **Scanner**: html5-qrcode
- **Gráficos**: Chart.js
- **Deploy**: Vercel

## 📦 Instalação

```bash
# Clonar o repositório
git clone https://github.com/SEU-USERNAME/nutri-scan.git
cd nutri-scan

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env.local
# Edita .env.local com as tuas chaves

# Iniciar servidor de desenvolvimento
npm run dev
