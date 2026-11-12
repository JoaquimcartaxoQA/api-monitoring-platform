# Revisão da Plataforma de Monitoramento de APIs

## O que o operador verá

- **Status público:** disponibilidade da fonte, total de eventos e quantidade de respostas 5xx na janela de sete dias UTC.
- **Área autenticada:** eventos mais recentes primeiro, 25 por página, atualização automática e busca por Request ID. A inspeção mostra horário, método, rota catalogada, HTTP, duração e ID quando presentes.
- **Acesso e auditoria:** login e logout, sessão expirada tratada na interface e eventos de autenticação gravados no PostgreSQL. O expurgo de auditoria mantém a janela de 90 dias.

Para iniciar e configurar o ambiente, siga o [README](../README.md).

## Rastreabilidade da revisão

| Decisão | Entrega local | Evidência |
|---|---|---|
| PEND-001 | Leitura JSONL somente leitura, janela UTC de sete dias e correlação | Testes HTTP com JSONL temporário, linhas inválidas, paginação, fonte ausente e vazia |
| PEND-002 | Backend separado, execução local e requisitos de hospedagem | Build de frontend e configuração local. Provedor, TLS e integração com fonte real ficam para a implantação |
| PEND-003 | Status agregado, rotas privadas, projeção por campos, sessão, origem e auditoria | Testes de acesso, origem, descarte de campos, logout e expurgo em PostgreSQL |

Resultado local: 9 testes passaram, incluindo a integração de auditoria em PostgreSQL 18.6 descartável. A avaliação visual e o fluxo completo da chamada no navegador fazem parte da etapa de homologação.

## Roteiro a autorizar — chamada API e Playwright MCP

Ambiente proposto: local, banco descartável de demonstração, operador temporário e pasta JSONL sintética exclusiva. A API de demonstração representa a aplicação monitorada. A aplicação real poderá ser homologada em uma rodada separada após identificação da rota e da fonte autorizadas.

1. Iniciar o banco dedicado, o monitor, o frontend e a aplicação sintética. Confirmar que a pasta de logs está isolada e que a área pública só exibe totais.
2. Fazer **uma** chamada `GET http://127.0.0.1:8790/health`. Validar HTTP 200, corpo `status: ok` e correspondência do `X-Request-Id` com o `requestId` do JSON. Guardar o ID para a validação.
3. Abrir o frontend com Playwright MCP e entrar com o operador temporário. Buscar pelo Request ID e abrir **Ver evento**. Conferir ID exato, `GET /health`, HTTP 200 e horário UTC compatível com a chamada.
4. Conferir o acesso ao filtro e aos detalhes em largura de tela móvel. Sair e verificar que a interface voltou à tela de acesso e que uma consulta sem sessão a `/api/logs` retorna 401. Registrar evidências da resposta e da tela de detalhes sem incluir senha ou cookie.
5. Relatar o resultado e as divergências. O aceite exige HTTP 200 e correspondência de todos os campos da etapa 3, além do bloqueio após logout.

**Situação do roteiro:** aguardando autorização e validação do usuário.
