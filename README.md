# SNW Whatsapp Notification

## Pagamentos

A integração de assinaturas mensais com o Asaas está documentada em
[`docs/ASAAS.md`](docs/ASAAS.md). Faça a validação no Sandbox antes de trocar
para a chave de produção.

## E-mails

Alertas, cobrança, recuperação de checkout, autenticação e campanhas com Resend
estão documentados em [`docs/RESEND.md`](docs/RESEND.md). Antes do deploy,
execute também `supabase/email-system.sql`.

Projeto inicial para plataforma de monitoramento de números WhatsApp integrada a UAZAPI, Evolution e Waha.

## Estrutura Supabase

- Autenticação: Supabase Auth
- Dados: PostgreSQL no Supabase
- RLS: controle por `workspace` e `user_profiles`
- Integrações: cada cliente escolhe a plataforma disponível
- Notificações: envio por e-mail e WhatsApp

## Arquivos principais

- `.env.example` - coloque aqui as chaves do Supabase
- `src/lib/supabaseClient.ts` - cliente Supabase para backend
- `supabase/schema.sql` - modelo de banco de dados e tabelas

## Passos iniciais

1. Crie um projeto no Supabase.
2. Copie as chaves para um arquivo `.env` com base em `.env.example`.
3. Importe `supabase/schema.sql` no SQL editor do Supabase.
4. Defina um `WEBHOOK_SECRET` longo e aleatório. Os provedores devem enviá-lo
   no header `X-Webhook-Secret` ao chamar os webhooks.
5. Instale dependências:
   ```bash
   npm install
   ```
6. Execute um teste básico:
   ```bash
   npm run dev
   ```

## Próximo passo

Depois que o Supabase estiver configurado, podemos criar:
- cadastro de workspace e clientes
- painel de seleção de plataforma
- evento de desconexão e geração de QR Code
- notificações por e-mail e WhatsApp

## Produção com Portainer

Para publicar o painel e a API em uma Stack Docker, siga
[docs/DEPLOY-PORTAINER.md](docs/DEPLOY-PORTAINER.md).
