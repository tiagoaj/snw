# Configuração das integrações SNW

## Antes de começar

O endereço do backend SNW precisa ser público e usar HTTPS. `localhost` não pode
receber webhooks de servidores externos. Substitua `https://snw.seudominio.com`
pelo domínio real e copie o ID da integração exibido no painel.

URL padrão do webhook:

```text
https://snw.seudominio.com/api/webhooks/providers/ID_DA_INTEGRACAO?secret=WEBHOOK_SECRET
```

O polling do SNW continua ativo como contingência, mesmo com o webhook configurado.

## UAZAPI

No painel SNW, informe:

- URL base, por exemplo `https://api.uazapi.com`;
- `admintoken` do servidor, não o token de apenas uma instância.

O SNW consulta `GET /instance/all` e importa todas as instâncias. No painel ou API
administrativa da UAZAPI, configure o webhook global:

```http
POST /globalwebhook
admintoken: SEU_ADMIN_TOKEN
Content-Type: application/json

{
  "enabled": true,
  "url": "URL_PADRAO_DO_WEBHOOK",
  "events": ["connection", "messages"],
  "addUrlEvents": false,
  "excludeMessages": ["fromMeYes", "isGroupYes"]
}
```

Em instalações sem acesso ao webhook global, configure `POST /webhook` em cada
instância usando seu header `token` e os eventos `connection` e `messages`.
O evento `messages` é necessário para receber a escolha `1` ou `2` do cliente.

## Evolution API v2

No painel SNW, informe a URL base e a API key global. O SNW consulta:

```http
GET /instance/fetchInstances
apikey: SUA_API_KEY
```

Em cada instância encontrada, configure:

```http
POST /webhook/set/NOME_DA_INSTANCIA
apikey: SUA_API_KEY
Content-Type: application/json

{
  "enabled": true,
  "url": "URL_PADRAO_DO_WEBHOOK",
  "webhookByEvents": false,
  "webhookBase64": false,
  "events": ["CONNECTION_UPDATE", "QRCODE_UPDATED", "MESSAGES_UPSERT"]
}
```

Repita a configuração para cada nova instância ou clique em **Sincronizar agora**
no SNW após criá-la.
O evento `MESSAGES_UPSERT` é necessário para receber a escolha `1` ou `2`.

## WAHA

No painel SNW, informe a URL do servidor WAHA e a API key. O SNW importa todas as
sessões por `GET /api/sessions?all=true`.

Para uma configuração global no `.env` do WAHA:

```env
WHATSAPP_HOOK_URL=https://snw.seudominio.com/api/webhooks/providers/ID_DA_INTEGRACAO
WHATSAPP_HOOK_EVENTS=session.status,message
WHATSAPP_HOOK_CUSTOM_HEADERS=X-Webhook-Secret:WEBHOOK_SECRET
WHATSAPP_HOOK_RETRIES_POLICY=linear
WHATSAPP_HOOK_RETRIES_DELAY_SECONDS=2
WHATSAPP_HOOK_RETRIES_ATTEMPTS=5
```

Reinicie o container WAHA após alterar o `.env`. Alternativamente, configure
`config.webhooks` individualmente em cada sessão, enviando o mesmo header
`X-Webhook-Secret`.
O evento `message` é necessário para receber a escolha `1` ou `2`.

## Verificação

1. Clique em **Salvar e sincronizar**.
2. Confirme se todas as instâncias aparecem na tabela.
3. Desconecte uma instância de teste.
4. O status deve mudar pelo webhook; se ele falhar, o polling fará a reconciliação.
5. Responda `1` ou `2` à mensagem recebida e confirme o envio do QR Code ou código.
6. Consulte `last_sync_error` no card da integração em caso de erro.
