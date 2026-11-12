# Plataforma de Monitoramento de APIs

Aplicação local para acompanhar uma fonte JSONL, consultar eventos com autenticação e correlacionar requisições..

## Início local

Requisitos: Node.js 24, npm e Docker com Compose. Execute os comandos nesta pasta.

1. Execute `npm ci`. Copie `.env.example` para `.env`. Escolha senhas locais distintas para o banco e para o operador. Preencha `POSTGRES_PASSWORD` e ajuste `DATABASE_URL` com o mesmo valor codificado para URL. Uma senha hexadecimal aleatória evita caracteres reservados na URL.
2. Gere o hash da senha do operador em PowerShell. Copie a saída do comando para `MONITOR_PASSWORD_HASH` em `.env`.

   ```powershell
   $env:MONITOR_SETUP_PASSWORD = Read-Host 'Senha do operador (mínimo de 12 caracteres)' -MaskInput
   npm run hash-password
   Remove-Item Env:MONITOR_SETUP_PASSWORD
   ```

3. Crie `var/demo` se quiser começar com uma fonte vazia. Para uma fonte já existente, configure `MONITOR_LOG_ROOT` para a pasta de logs.
4. Execute `docker compose up -d --wait audit-db`. Em dois terminais, execute `npm start` e `npm run dev`.
5. Abra `http://127.0.0.1:5173`. A página exibe status agregado sem login. Use o operador configurado para abrir Eventos da API. Informe o Request ID para buscar, selecione **Ver evento** para inspecionar e **Correlacionar eventos** para repetir a busca pelo identificador. Use **Atualizar** para voltar aos dados mais recentes.

`npm run demo-api` inicia a aplicação sintética separada em `127.0.0.1:8790`. A execução da chamada combinada com Playwright MCP está descrita no roteiro de validação. Para encerrar o ambiente local, interrompa os processos com Ctrl+C e use `docker compose stop audit-db`. Os registros de auditoria permanecem no volume.

## Contrato da fonte

- Uma pasta dedicada e uma aplicação produtora por instalação. Um arquivo `AAAA-MM-DD.jsonl` por dia UTC. Cada evento termina em quebra de linha. O produtor deve fazer a rotação e o expurgo físico em sete dias. O monitor lê apenas o dia atual e os seis dias UTC anteriores.
- A fonte deve ser controlada pelo operador. Monte-a como somente leitura para a conta do backend e restrinja a escrita ao produtor. O backend ignora entradas fora da convenção e links simbólicos identificados na leitura.
- Evento de exemplo: `{"timestamp":"2026-11-11T18:20:00.000Z","operation":"demo.health","method":"GET","status":200,"requestId":"3b562da3-a78f-41e1-a906-23f7a0876ad6","durationMs":12}`.
- O produtor deve gerar um UUID v4 aleatório como `requestId` e propagá-lo entre eventos da requisição. Campos ausentes ou identificadores fora do padrão aparecem sem correlação. `operation` é um código do catálogo `MONITOR_OPERATIONS`, que mapeia códigos a modelos de rota estáticos. Use `/pedidos/{id}` no catálogo e evite caminhos com valores reais.
- A projeção do backend descarta corpo, URL bruta, cabeçalhos, mensagens livres e campos extras. Na origem, registre apenas os campos necessários e evite gravar segredos em qualquer campo.
- Limite do MVP: 16 MiB de entrada e 50 mil eventos válidos por janela de leitura. Ultrapassar o limite retorna indisponibilidade. As visões de paginação são temporárias, expiram em até cinco minutos e podem ser descartadas quando a sessão abre muitas consultas. A primeira página consulta dados atualizados em ciclos de 30 segundos. Páginas históricas mantêm o recorte, com atualização manual disponível.

## API e operação

| Rota | Acesso | Resultado |
|---|---|---|
| GET /api/status | Público | Estado da fonte, contagem de eventos e contagem 5xx na janela |
| POST /api/session | Origem configurada | Login por JSON com `user` e `password` |
| GET /api/session | Público | Indicador de sessão autenticada |
| GET /api/logs | Sessão | 25 eventos por página, com `requestId`, `page` e `view` |
| POST /api/logout | Sessão e origem configurada | Invalidação da sessão |

O MVP usa um operador configurado por instalação e sessões em memória com 30 minutos de validade. A auditoria registra tipo e horário UTC de login bem-sucedido, falha de credencial e logout. O expurgo é executado na inicialização e a cada hora. A conta PostgreSQL precisa das permissões de criação inicial de tabela e índice, gravação e expurgo no banco dedicado.

Para hospedagem, selecione um host que tenha acesso local ou privado aos logs. Use proxy reverso HTTPS diante do backend ligado em loopback, conta dedicada, PostgreSQL privado e origens HTTPS exatas. Remova `MONITOR_LOCAL_HTTP=1` e configure a pasta absoluta. Use frontend e API sob o mesmo site para compatibilidade com cookies `SameSite=Strict`. Para GitHub Pages, a opção planejada é domínio personalizado sob o mesmo domínio registrável da API, ou um proxy de mesma origem diante do frontend e do backend. Defina `VITE_API_ORIGIN` no build quando usar origens distintas sob o mesmo site. Valide TLS, política de cookies e CORS no destino escolhido. Um domínio padrão `github.io` e uma API em domínio de outro site exigem outra topologia.

## Verificações

- `npm test` executa testes da API usando arquivos temporários. Para incluir PostgreSQL, aponte `MONITOR_TEST_DATABASE_URL` para um banco descartável dedicado, pois o teste insere e expurga dados.
- `npm run build` verifica TypeScript e gera a pasta `dist`.
