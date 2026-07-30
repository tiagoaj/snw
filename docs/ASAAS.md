# Pagamentos com Asaas

O SNW usa o Checkout hospedado do Asaas. O cartão é informado diretamente no
ambiente do Asaas e nunca passa pelo frontend ou pelo banco do SNW.

## Fluxo implementado

1. O cliente escolhe um plano no workspace.
2. O backend usa o preço oficial do plano e cria um checkout recorrente mensal.
3. O cliente é redirecionado ao Asaas para informar os dados.
4. O retorno para o SNW é apenas informativo.
5. A assinatura só fica ativa quando o webhook autenticado do Asaas confirma o
   pagamento.

O `nextDueDate` enviado ao Asaas respeita os dias gratuitos ainda disponíveis.
O primeiro meio de pagamento liberado é cartão de crédito, pois permite a
renovação mensal automática.

## Carência, suspensão e desbloqueio

Quando o webhook recebe `PAYMENT_OVERDUE`,
`PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` ou
`PAYMENT_REPROVED_BY_RISK_ANALYSIS`, o SNW:

1. marca a assinatura como pendente;
2. registra uma carência única de três dias, sem renová-la a cada novo evento;
3. avisa o e-mail do responsável e, quando configurado, seu WhatsApp;
4. mantém a operação e os alertas ativos durante a carência;
5. após o prazo, suspende alterações operacionais e todos os disparos de
   WhatsApp e e-mail das integrações.

As áreas `Assinatura` e `Pagamentos` continuam disponíveis para regularização.
Ao receber `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`, o SNW remove a pendência,
restabelece a operação automaticamente e envia uma confirmação ao cliente.

## 1. Criar as tabelas no Supabase

No Supabase, abra `SQL Editor`, cole todo o conteúdo de
`supabase/asaas-billing.sql` e clique em `Run`.

O script pode ser executado novamente sem apagar assinaturas existentes.

## 2. Configurar primeiro no Sandbox

Crie ou acesse uma conta no Sandbox do Asaas e gere uma chave de API. Chaves de
Sandbox começam com `$aact_hmlg_`.

No ambiente local:

```env
APP_PUBLIC_URL=http://localhost:5173
ASAAS_ENVIRONMENT=sandbox
ASAAS_API_KEY=SUA_CHAVE_DE_SANDBOX
ASAAS_WEBHOOK_TOKEN=UM_TOKEN_FORTE_EXCLUSIVO
```

O token do webhook deve ter entre 32 e 255 caracteres, não pode conter espaços
e não pode ser a chave da API do Asaas.

## 3. Criar o Webhook no Asaas

Na área de Webhooks do Asaas, crie um webhook com:

- URL: `https://snw.fluinow.com.br/api/webhooks/asaas`
- Envio: sequencial
- Token de autenticação: exatamente o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
- Ativo: sim

Eventos:

```text
CHECKOUT_CREATED
CHECKOUT_CANCELED
CHECKOUT_EXPIRED
CHECKOUT_PAID
SUBSCRIPTION_CREATED
SUBSCRIPTION_UPDATED
SUBSCRIPTION_INACTIVATED
SUBSCRIPTION_DELETED
PAYMENT_CONFIRMED
PAYMENT_RECEIVED
PAYMENT_OVERDUE
PAYMENT_CREDIT_CARD_CAPTURE_REFUSED
PAYMENT_REPROVED_BY_RISK_ANALYSIS
```

O Asaas enviará o token no header `asaas-access-token`. Não use Bearer Token e
não coloque o token na URL.

## 4. Configurar no Portainer

Crie dois Docker Secrets adicionais:

```text
snw_asaas_api_key
snw_asaas_webhook_token
```

Conteúdo do primeiro: a chave da API do Asaas. Conteúdo do segundo: o mesmo
token configurado no Webhook.

Nas variáveis da Stack, adicione:

```env
APP_PUBLIC_URL=https://snw.fluinow.com.br
ASAAS_ENVIRONMENT=sandbox
```

Faça o redeploy da Stack. O arquivo `docker-compose.portainer.yml` já conecta
os dois secrets ao serviço da API.

## 5. Passar para produção

Depois de validar uma assinatura no Sandbox:

1. gere uma chave de API na conta de produção do Asaas;
2. substitua o conteúdo do secret `snw_asaas_api_key`;
3. crie na conta de produção o mesmo Webhook e token;
4. altere `ASAAS_ENVIRONMENT` para `production`;
5. faça o redeploy.

Chaves de produção começam com `$aact_prod_`. Nunca use uma chave de produção
com `ASAAS_ENVIRONMENT=sandbox`, nem o contrário.

## Segurança e diagnóstico

- Preços são definidos exclusivamente em `src/lib/billingService.ts`.
- O frontend não recebe a API key nem o token do webhook.
- Eventos são salvos em `billing_webhook_events` e não são processados duas
  vezes quando o Asaas os reenvia.
- Consulte no Asaas `Integrações > Webhook Logs` para ver HTTP status e payload.
- O endpoint precisa responder HTTP 200; redirecionamentos não são seguidos.

Documentação oficial:

- https://docs.asaas.com/docs/asaas-checkout
- https://docs.asaas.com/docs/checkout-with-subscription-recurring
- https://docs.asaas.com/docs/create-new-webhook-via-api
- https://docs.asaas.com/docs/webhooks-events
