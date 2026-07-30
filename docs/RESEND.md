# E-mails do SNW com Resend

O SNW usa a Resend para cinco grupos de mensagens:

1. **Status operacional:** desconexão e reconexão de números monitorados.
2. **Cobrança:** teste grátis, pagamento pendente, confirmação e bloqueio.
3. **Plataforma:** boas-vindas e comunicações essenciais da conta.
4. **Recuperação de checkout:** lembretes automáticos de checkout iniciado e não concluído.
5. **Campanhas:** mensagens comerciais enviadas pelo superadmin.

Alertas operacionais, autenticação e cobrança são transacionais. O link de
descadastro existe nas campanhas e na recuperação de checkout; portanto, um
cliente que cancela comunicações comerciais continua recebendo apenas mensagens
essenciais da conta.

## 1. Banco de dados

No SQL Editor do Supabase, execute:

```text
supabase/email-system.sql
```

O script é idempotente e cria auditoria de mensagens, campanhas, destinatários,
descadastros, supressões por bounce/spam e eventos recebidos da Resend.

## 2. Variáveis no Portainer

Na Stack do SNW, em **Environment variables**, configure:

```dotenv
RESEND_API_KEY=re_xxxxxxxxx
NOTIFICATION_EMAIL_FROM=SNW <alertas@fluinow.com.br>
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxx
EMAIL_UNSUBSCRIBE_SECRET=gere-uma-chave-aleatoria-longa-com-32-ou-mais-caracteres
EMAIL_CAMPAIGN_INTERVAL_MS=60000
EMAIL_AUTOMATION_INTERVAL_MS=900000
```

- `RESEND_API_KEY`: chave da Resend com permissão para enviar.
- `NOTIFICATION_EMAIL_FROM`: remetente em um domínio verificado.
- `RESEND_WEBHOOK_SECRET`: Signing Secret fornecido ao criar o webhook.
- `EMAIL_UNSUBSCRIBE_SECRET`: segredo próprio do SNW para assinar os links de
  descadastro. Não use a API key da Resend aqui.
- Os intervalos são, respectivamente, 1 minuto para campanhas e 15 minutos para
  automações.

Em desenvolvimento, coloque as mesmas chaves no `.env` local. Nunca envie o
arquivo `.env` para o GitHub.

## 3. Webhook da Resend

Em **Resend > Webhooks > Add Webhook**, informe:

```text
https://snw.fluinow.com.br/api/webhooks/resend
```

Marque:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.complained`
- `email.failed`

Copie o **Signing Secret** exibido pela Resend para
`RESEND_WEBHOOK_SECRET`. O backend verifica a assinatura sobre o corpo original
da requisição, registra o `svix-id` e ignora reentregas duplicadas.

Quando a Resend informa bounce ou reclamação de spam, o destinatário entra na
lista de supressão do SNW e não recebe novos envios pela API.

## 4. Recuperação de senha e e-mails do Supabase Auth

A recuperação de senha é disparada pelo Supabase Auth. Para ela também sair pela
Resend, configure o provedor no painel da Resend em
**Integrations > Supabase**, ou preencha o SMTP no Supabase:

```text
Host: smtp.resend.com
Porta: 465
Usuário: resend
Senha: sua RESEND_API_KEY
Sender name: SNW
Sender email: alertas@fluinow.com.br
```

No Supabase, confira também:

- **Authentication > URL Configuration > Site URL**:
  `https://snw.fluinow.com.br`
- **Redirect URLs**: inclua `https://snw.fluinow.com.br/**` e, para
  desenvolvimento, `http://localhost:5173/**`.
- **Authentication > Email Templates > Reset password**: mantenha a variável de
  link de recuperação fornecida pelo Supabase.

O botão **Esqueci minha senha** do login chama o Supabase sem revelar se o
endereço possui ou não uma conta.

## 5. Automações incluídas

- **Boas-vindas:** logo após a criação da conta/workspace.
- **Fim do teste:** uma vez, quando faltarem até 48 horas.
- **Carrinho/checkout:** primeiro lembrete após aproximadamente uma hora e
  último lembrete quando faltarem até seis horas para expirar.
- **Cobrança:** usa os eventos do Asaas já processados pelo SNW.
- **Status:** usa as transições confirmadas de conectado para desconectado e
  vice-versa.

As automações usam chaves de idempotência para impedir e-mails duplicados.

## 6. Campanhas no superadmin

Abra **E-mails** no menu do superadmin. É possível:

- selecionar todos os clientes, assinaturas ativas, testes, checkout pendente
  ou inadimplentes;
- visualizar a quantidade de destinatários elegíveis;
- configurar assunto, prévia, conteúdo e botão;
- enviar um teste;
- confirmar o disparo e acompanhar o histórico.

Cada cliente recebe um envio individual com link de descadastro assinado. Não
use campanhas para alertas operacionais ou cobranças.

## 7. Checklist de teste

1. Execute `supabase/email-system.sql`.
2. Configure todas as variáveis e faça o redeploy da Stack.
3. Use o envio de teste do superadmin.
4. Confira a mensagem em **Resend > Emails**.
5. Confirme a chegada do evento `email.delivered` no histórico do webhook.
6. Teste o link de descadastro usando um endereço controlado por você.
7. No login, teste **Esqueci minha senha**.
