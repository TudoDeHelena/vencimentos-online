# Gerenciador de Clientes PWA

Aplicativo web/PWA funcional para cadastro, busca e controle de clientes, vencimentos, cobranças, status, importação/exportação JSON e funcionamento offline.

## Como usar

1. Abra `index.html` em um navegador moderno.
2. Para instalar como PWA/offline, hospede a pasta em um servidor HTTPS ou use um servidor local.
3. Para testar localmente com Service Worker:
   ```bash
   python -m http.server 8000
   ```
   Depois acesse `http://localhost:8000`.

## Arquivos principais

- `index.html`: estrutura da aplicação.
- `style.css`: visual responsivo, tema claro/escuro e modais corrigidos.
- `app.js`: lógica de cadastro, filtros, ações em lote, importação/exportação e PWA.
- `manifest.json`: metadados do app instalável.
- `service-worker.js`: cache offline.
- `icons/icon-192.svg`: ícone do aplicativo.

## Correções aplicadas

- Modais agora abrem por cima do overlay e ficam clicáveis.
- Ícone do PWA foi colocado no caminho correto (`icons/icon-192.svg`).
- Service Worker ficou mais tolerante a falhas de cache e tem fallback offline.
- Adicionado filtro/contador "Ver Depois".
- Tabela mostra vencimento, cobrança e ver depois.
- Importação JSON agora normaliza campos para evitar que registros incompletos quebrem a interface.
- Botão de menu passa a ocultar a sidebar também no desktop.

## Atualização desta versão

- Campo de busca corrigido para funcionar no celular sem esticar a tela.
- Busca agora procura por nome, telefone, produto, vencimento, cobrança, ver depois e observações.
- Importação adaptada ao JSON anexado com campos `Produto`, `data`, `dataCobranca`, `reexibirEm`, `observacao` e `logs`.
- `data` no formato `dd/mm/aaaa` agora vira vencimento interno no formato correto.
- Cada cliente ganhou atalho de cobrança pelo WhatsApp: clique no telefone ou no botão 💬 da linha.
- Botão “Msg Próximo Vencido” corrigido para não duplicar o código 55 do telefone.
- Ao abrir cobrança pelo WhatsApp, o cliente é marcado como avisado e recebe registro no histórico.


## Integração Google Sheets

Esta versão moderna foi adaptada para usar o mesmo Web App do Google Apps Script da versão antiga.

- Ao abrir o app, ele tenta puxar os clientes do Google Sheets automaticamente.
- Alterações feitas no app continuam sendo salvas no navegador e também são enviadas para o Google Sheets.
- Na barra lateral há botões para puxar novamente do Google Sheets ou forçar o envio da lista local para o Sheets.
- Se estiver offline ou o Apps Script falhar, o app mantém os dados locais e mostra o status no topo.

## Ajustes mobile desta versão

- Menu lateral começa fechado no celular.
- Depois de escolher uma opção no menu, ele fecha automaticamente.
- Filtros e select de produto ocupam 100% da tela no mobile.
- Cards de status deixam de ficar espremidos.
- Tabela vira cartões no celular para melhorar a leitura e os botões de ação.
- Botão 📋 copia a mesma mensagem de cobrança enviada pelo WhatsApp.
