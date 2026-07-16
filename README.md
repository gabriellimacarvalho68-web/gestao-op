# Gestão Operações

App (PWA) para gestão de compra e venda de contas do TikTok — estoque, vendas, lucro e histórico. Dados salvos localmente no dispositivo (localStorage), sem servidor.

## Como testar no computador

Na pasta do projeto, rode:

```
python -m http.server 8123
```

e abra `http://localhost:8123` no navegador.

## Como instalar no iPhone

O app precisa estar publicado em um endereço HTTPS. O caminho gratuito mais simples é o **GitHub Pages**:

1. Crie uma conta no [github.com](https://github.com) (se ainda não tiver).
2. Crie um repositório novo (ex.: `gestao-op`) e envie todos os arquivos desta pasta.
3. No repositório: **Settings → Pages → Source: Deploy from a branch → main → / (root)** e salve.
4. Em ~1 minuto o app estará em `https://SEU-USUARIO.github.io/gestao-op/`.

No iPhone:

1. Abra esse endereço no **Safari**.
2. Toque no botão de **Compartilhar** (quadrado com seta para cima).
3. Toque em **Adicionar à Tela de Início**.
4. Pronto — o app aparece com ícone próprio, abre em tela cheia e funciona offline.

## Importante sobre os dados

- Os dados ficam salvos **apenas no dispositivo** (localStorage do navegador/app).
- Não limpe os dados do Safari nas configurações do iPhone, ou os registros serão apagados.
- **Backup**: toque no ícone de nuvem no Dashboard → **Exportar backup** para salvar um arquivo com tudo (em Arquivos/iCloud, WhatsApp, email). Para recuperar, use **Importar backup** na mesma tela.
- As senhas das contas são armazenadas **sem criptografia** no dispositivo — o app é de uso pessoal; não compartilhe o aparelho desbloqueado.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Estrutura da página e barra de navegação |
| `app.js` | Telas e navegação (Dashboard, Contas, Cadastro, Detalhes, Venda) |
| `db.js` | Camada de dados e regras de negócio (RN1–RN6) |
| `styles.css` | Visual (estética iOS, paleta do PRD) |
| `sw.js` | Funcionamento offline |
| `manifest.webmanifest` + `icons/` | Identidade do app instalado |
