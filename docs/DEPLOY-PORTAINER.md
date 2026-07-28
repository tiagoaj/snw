# Publicação do SNW no Portainer Swarm com Traefik

Esta configuração publica:

- painel: `https://snw.fluinow.com.br`
- API: `https://snw.fluinow.com.br/api`
- webhooks: `https://snw.fluinow.com.br/api/webhooks/providers/ID_DA_INTEGRACAO?secret=SEU_WEBHOOK_SECRET`

## 1. DNS

No provedor do domínio, crie:

| Tipo | Nome | Destino |
| --- | --- | --- |
| A | `snw` | IP público que recebe o tráfego do Traefik |

Se o cluster usa IPv6, crie também o registro AAAA. Aguarde a propagação antes
de emitir o certificado SSL.

## 2. Publicar as imagens no GitHub Container Registry

O Docker Swarm não constrói os Dockerfiles durante o deploy. O workflow
`.github/workflows/publish-images.yml` gera e publica automaticamente:

- `ghcr.io/tiagoaj/snw-api:latest`
- `ghcr.io/tiagoaj/snw-web:latest`

Envie os arquivos para a branch `main` e acompanhe em **GitHub > Actions >
Publish Docker images**.

Por padrão, novos packages do GHCR podem ser privados. Em **GitHub > perfil
tiagoaj > Packages**, abra cada package, acesse **Package settings > Change
visibility** e deixe público. Se preferir mantê-los privados, cadastre o GHCR em
**Portainer > Registries** com um token GitHub que tenha `read:packages` e use
essa autenticação ao implantar a Stack.

## 3. Criar os Docker Secrets

Antes da Stack, acesse **Portainer > Secrets > Add secret** e crie exatamente:

| Nome do secret | Conteúdo |
| --- | --- |
| `snw_supabase_service_role_key` | valor atual de `SUPABASE_SERVICE_ROLE_KEY` |
| `snw_webhook_secret` | valor atual de `WEBHOOK_SECRET` |
| `snw_integration_encryption_key` | valor atual de `INTEGRATION_ENCRYPTION_KEY` |

Use os valores atuais. Alterar `WEBHOOK_SECRET` invalida as URLs de webhook já
configuradas. Alterar `INTEGRATION_ENCRYPTION_KEY` impede a leitura das
credenciais de integrações que já foram criptografadas.

## 4. Criar a Stack pelo Git no Portainer

1. Entre no ambiente Swarm e abra **Stacks > Add stack**.
2. Nomeie a Stack como `snw`.
3. Selecione **Git repository**.
4. Use `https://github.com/tiagoaj/snw.git`.
5. Em **Compose path**, informe `docker-compose.portainer.yml`.
6. Caso o repositório seja privado, informe um token GitHub para clonar o Git.
7. Cadastre as variáveis da próxima seção.
8. Clique em **Deploy the stack**.

## 5. Variáveis da Stack

Obrigatórias:

```env
APP_ORIGIN=https://snw.fluinow.com.br
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=
SNW_DOMAIN=snw.fluinow.com.br
TRAEFIK_NETWORK=traefik-public
TRAEFIK_HTTP_ENTRYPOINT=web
TRAEFIK_HTTPS_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=letsencrypt
SNW_IMAGE_TAG=latest
```

Opcionais:

```env
RESEND_API_KEY=
NOTIFICATION_EMAIL_FROM=SNW <alertas@fluinow.com.br>
MONITOR_INTERVAL_MS=60000
MONITOR_FAILURE_THRESHOLD=2
ALERT_COOLDOWN_MS=300000
RECONNECT_REQUEST_TTL_MS=900000
```

Não coloque credenciais no GitHub. As três credenciais críticas ficam nos
Docker Secrets e as demais configurações nas variáveis da Stack.

Para gerar segredos novos em uma máquina com Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

A primeira saída serve para um novo `WEBHOOK_SECRET` e a segunda para uma nova
`INTEGRATION_ENCRYPTION_KEY`. Em uma instalação que já possui integrações, use
as chaves existentes.

## 6. Traefik e HTTPS

A Stack contém labels de serviço, dentro de `deploy.labels`, para:

- descobrir automaticamente o serviço `web`;
- responder ao host `snw.fluinow.com.br`;
- redirecionar HTTP para HTTPS;
- emitir ou usar o certificado pelo resolver configurado;
- encaminhar o tráfego para a porta interna 80.

Não é necessário publicar a porta 8080. O Traefik e o serviço `web` precisam
estar conectados à mesma rede `overlay` externa. O backend fica somente na rede
interna e é acessado pelo Nginx do frontend em `/api`.

Use o nome real completo da rede do Traefik. Redes criadas por outra Stack podem
receber um prefixo; por exemplo, uma rede `public` criada pela Stack `traefik`
pode aparecer como `traefik_public`.

Se a rede se chamar `proxy`, use:

```env
TRAEFIK_NETWORK=proxy
```

Se o resolver se chamar `cloudflare`, use:

```env
TRAEFIK_CERT_RESOLVER=cloudflare
```

## 7. Configurar o Supabase

Em **Authentication > URL Configuration**:

- Site URL: `https://snw.fluinow.com.br`
- Redirect URLs: `https://snw.fluinow.com.br/**`

Você pode manter `http://localhost:5173/**` para o desenvolvimento local.

## 8. Validar

Abra:

```text
https://snw.fluinow.com.br
https://snw.fluinow.com.br/api/health
```

O segundo endereço deve responder:

```json
{"status":"ok"}
```

No Portainer, os serviços `snw_api` e `snw_web` devem ficar com todas as tasks
ativas. A Stack mantém duas réplicas do frontend e exatamente uma da API, pois a
API executa o monitoramento em segundo plano.

## 9. Atualizar depois de um push

Depois de um push, aguarde o workflow terminar. Para uma atualização
determinística, troque `SNW_IMAGE_TAG=latest` pela tag `sha-...` publicada pelo
workflow e use **Pull and redeploy**. Assim o Swarm faz o rolling update e pode
reverter em caso de falha.
