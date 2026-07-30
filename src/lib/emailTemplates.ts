export type EmailTemplateKey =
  | 'status_disconnected'
  | 'status_reconnected'
  | 'billing_notice'
  | 'welcome'
  | 'trial_ending'
  | 'cart_recovery'
  | 'campaign'

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

export type EmailTemplateDefinition = {
  key: EmailTemplateKey
  display_name: string
  category: 'status' | 'billing' | 'platform' | 'marketing' | 'cart_recovery'
  usage_description: string
  subject_template: string
  preheader_template: string
  eyebrow_template: string
  title_template: string
  content_template: string
  button_label_template: string
  button_url_template: string
  available_variables: string[]
}

export type EmailTemplateOverride = Partial<Omit<
  EmailTemplateDefinition,
  'key' | 'display_name' | 'category' | 'usage_description' | 'available_variables'
>>

export const emailTemplateCatalog: Record<EmailTemplateKey, EmailTemplateDefinition> = {
  status_disconnected: {
    key: 'status_disconnected',
    display_name: 'Alerta de número desconectado',
    category: 'status',
    usage_description: 'Enviado ao responsável técnico quando uma instância monitorada tem a desconexão confirmada.',
    subject_template: 'WhatsApp desconectado — {{numberName}}',
    preheader_template: 'O número {{numberName}} precisa de atenção.',
    eyebrow_template: 'Alerta operacional',
    title_template: 'Uma conexão precisa de atenção',
    content_template: '{{greeting}}\n\nO número {{numberName}} foi desconectado. Acesse o painel para acompanhar a reconexão.',
    button_label_template: 'Abrir monitoramento',
    button_url_template: '{{dashboardUrl}}',
    available_variables: ['customerName', 'greeting', 'numberName', 'phone', 'dashboardUrl']
  },
  status_reconnected: {
    key: 'status_reconnected',
    display_name: 'Confirmação de reconexão',
    category: 'status',
    usage_description: 'Enviado ao responsável técnico quando uma instância anteriormente desconectada volta a funcionar.',
    subject_template: 'WhatsApp reconectado — {{numberName}}',
    preheader_template: 'O número {{numberName}} voltou ao estado normal.',
    eyebrow_template: 'Conexão restabelecida',
    title_template: 'Operação normalizada',
    content_template: '{{greeting}}\n\nO número {{numberName}} foi reconectado e voltou ao estado normal.',
    button_label_template: 'Ver no painel',
    button_url_template: '{{dashboardUrl}}',
    available_variables: ['customerName', 'greeting', 'numberName', 'phone', 'dashboardUrl']
  },
  billing_notice: {
    key: 'billing_notice',
    display_name: 'Aviso de cobrança e bloqueio',
    category: 'billing',
    usage_description: 'Usado nos avisos de pagamento recusado, período de tolerância, bloqueio e regularização da assinatura.',
    subject_template: '{{subject}}',
    preheader_template: '{{subject}}',
    eyebrow_template: 'Assinatura e cobrança',
    title_template: '{{subject}}',
    content_template: '{{greeting}}\n\n{{message}}',
    button_label_template: 'Ver cobrança',
    button_url_template: '{{buttonUrl}}',
    available_variables: ['customerName', 'greeting', 'subject', 'message', 'buttonUrl', 'dashboardUrl']
  },
  welcome: {
    key: 'welcome',
    display_name: 'Boas-vindas e início do teste',
    category: 'platform',
    usage_description: 'Enviado imediatamente após a criação e ativação de uma nova conta e workspace.',
    subject_template: 'Bem-vindo ao SNW — seu monitoramento já pode começar',
    preheader_template: 'Configure suas integrações e comece a monitorar.',
    eyebrow_template: 'Bem-vindo ao SNW',
    title_template: 'Sua operação ganhou uma camada de proteção',
    content_template: '{{greeting}}\n\nSeu workspace foi criado e seus 7 dias grátis começaram. Configure as integrações escolhidas para importar e monitorar suas instâncias.\n\nSeu período gratuito termina em {{trialEndsAt}}.',
    button_label_template: 'Configurar meu workspace',
    button_url_template: '{{dashboardUrl}}',
    available_variables: ['customerName', 'greeting', 'trialEndsAt', 'dashboardUrl']
  },
  trial_ending: {
    key: 'trial_ending',
    display_name: 'Teste grátis terminando',
    category: 'platform',
    usage_description: 'Enviado automaticamente quando faltam até 48 horas para o término do período gratuito.',
    subject_template: 'Seu teste grátis do SNW termina em breve',
    preheader_template: 'Cadastre o cartão para manter o monitoramento sem interrupção.',
    eyebrow_template: 'Teste grátis',
    title_template: 'Continue protegido depois do período gratuito',
    content_template: '{{greeting}}\n\nSeu período gratuito termina em {{trialEndsAt}}. Cadastre o cartão para manter o monitoramento e os alertas ativos sem interrupção.',
    button_label_template: 'Ativar minha assinatura',
    button_url_template: '{{dashboardUrl}}/?section=subscription',
    available_variables: ['customerName', 'greeting', 'trialEndsAt', 'dashboardUrl']
  },
  cart_recovery: {
    key: 'cart_recovery',
    display_name: 'Recuperação de checkout',
    category: 'cart_recovery',
    usage_description: 'Enviado automaticamente para clientes que iniciaram o checkout, mas ainda não concluíram a assinatura.',
    subject_template: '{{subject}}',
    preheader_template: '{{subject}}',
    eyebrow_template: 'Assinatura pendente',
    title_template: 'Falta pouco para concluir',
    content_template: '{{greeting}}\n\nSeu checkout ainda não foi concluído. Retome de onde parou para manter o monitoramento e os alertas da sua operação ativos.',
    button_label_template: 'Continuar pagamento',
    button_url_template: '{{checkoutUrl}}',
    available_variables: ['customerName', 'greeting', 'subject', 'checkoutUrl', 'unsubscribeUrl', 'dashboardUrl']
  },
  campaign: {
    key: 'campaign',
    display_name: 'Layout das campanhas em massa',
    category: 'marketing',
    usage_description: 'Estrutura visual aplicada às campanhas criadas manualmente no menu Campanhas. O conteúdo de cada envio vem da campanha.',
    subject_template: '{{subject}}',
    preheader_template: '{{preheader}}',
    eyebrow_template: 'Novidades SNW',
    title_template: '{{title}}',
    content_template: '{{greeting}}\n\n{{contentText}}',
    button_label_template: '{{buttonLabel}}',
    button_url_template: '{{buttonUrl}}',
    available_variables: ['customerName', 'greeting', 'subject', 'title', 'preheader', 'contentText', 'buttonLabel', 'buttonUrl', 'unsubscribeUrl']
  }
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
})[character]!)

const paragraphs = (value: unknown) => String(value ?? '')
  .split(/\n{2,}/)
  .map((paragraph) => `<p style="margin:0 0 16px;color:#a9bbb5;font-size:15px;line-height:1.7">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
  .join('')

function appUrl() {
  return (process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN || 'https://snw.fluinow.com.br')
    .split(',')[0]
    .replace(/\/+$/, '')
}

function layout(input: {
  eyebrow: string
  title: string
  preheader?: string
  contentHtml: string
  buttonLabel?: string
  buttonUrl?: string
  footer?: string
}) {
  const button = input.buttonLabel && input.buttonUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px"><tr><td style="border-radius:10px;background:#42e3a5"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;padding:14px 22px;color:#06130f;text-decoration:none;font-size:14px;font-weight:800">${escapeHtml(input.buttonLabel)}</a></td></tr></table>`
    : ''
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;background:#06110e;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader || input.title)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#06110e">
    <tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px">
        <tr><td style="padding:0 4px 18px">
          <a href="${escapeHtml(appUrl())}" style="color:#f1f7f4;text-decoration:none;font-size:24px;font-weight:900">SNW<span style="color:#42e3a5">•</span></a>
          <span style="display:block;margin-top:5px;color:#6f8980;font-size:10px;letter-spacing:.14em;text-transform:uppercase">WhatsApp Operations</span>
        </td></tr>
        <tr><td style="border:1px solid #193a30;border-radius:18px;background:#0b1b16;padding:34px 32px">
          <div style="margin-bottom:12px;color:#42e3a5;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">${escapeHtml(input.eyebrow)}</div>
          <h1 style="margin:0 0 20px;color:#f0f6f3;font-size:28px;line-height:1.2">${escapeHtml(input.title)}</h1>
          ${input.contentHtml}
          ${button}
        </td></tr>
        <tr><td style="padding:18px 6px;color:#60786f;font-size:11px;line-height:1.6">
          ${input.footer || `Mensagem automática do SNW. Acesse <a href="${escapeHtml(appUrl())}" style="color:#74dcb3">${escapeHtml(appUrl())}</a>.`}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function interpolateTemplate(value: string, variables: Record<string, unknown>) {
  return String(value || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => (
    variables[key] === undefined || variables[key] === null ? '' : String(variables[key])
  ))
}

function renderCustomTemplate(
  key: EmailTemplateKey,
  variables: Record<string, unknown>,
  override: EmailTemplateOverride
): RenderedEmail {
  const definition = { ...emailTemplateCatalog[key], ...override }
  const customerName = String(variables.customerName || '').trim()
  const dashboardUrl = String(variables.dashboardUrl || appUrl()).replace(/\/+$/, '')
  const resolvedVariables: Record<string, unknown> = {
    ...variables,
    customerName,
    greeting: customerName ? `Olá, ${customerName}.` : 'Olá.',
    dashboardUrl,
    numberName: variables.numberName || variables.phone || 'monitorado',
    subject: variables.subject || emailTemplateCatalog[key].subject_template,
    title: variables.title || variables.subject || emailTemplateCatalog[key].title_template,
    preheader: variables.preheader || variables.subject || '',
    contentText: variables.contentText || '',
    buttonUrl: variables.buttonUrl || `${dashboardUrl}/?section=payments`,
    checkoutUrl: variables.checkoutUrl || dashboardUrl,
    buttonLabel: variables.buttonLabel || ''
  }
  const subject = interpolateTemplate(definition.subject_template, resolvedVariables)
  const preheader = interpolateTemplate(definition.preheader_template, { ...resolvedVariables, subject })
  const title = interpolateTemplate(definition.title_template, { ...resolvedVariables, subject })
  const contentText = interpolateTemplate(definition.content_template, { ...resolvedVariables, subject, title })
  const buttonLabel = interpolateTemplate(definition.button_label_template, resolvedVariables)
  const buttonUrl = interpolateTemplate(definition.button_url_template, resolvedVariables)
  const eyebrow = interpolateTemplate(definition.eyebrow_template, resolvedVariables)
  const unsubscribe = String(variables.unsubscribeUrl || '')
  const marketingFooter = key === 'campaign' || key === 'cart_recovery'
    ? unsubscribe
      ? `Você recebeu esta comunicação por possuir uma conta no SNW. <a href="${escapeHtml(unsubscribe)}" style="color:#74dcb3">Cancelar comunicações comerciais</a>.`
      : 'Você recebeu esta comunicação por possuir uma conta no SNW.'
    : undefined
  return {
    subject,
    text: `${contentText}${unsubscribe ? `\n\nDescadastrar: ${unsubscribe}` : ''}`,
    html: layout({
      eyebrow,
      title,
      preheader,
      contentHtml: paragraphs(contentText),
      buttonLabel: buttonLabel || undefined,
      buttonUrl: buttonUrl || undefined,
      footer: marketingFooter
    })
  }
}

export function renderEmailTemplate(
  key: EmailTemplateKey,
  variables: Record<string, unknown>,
  override?: EmailTemplateOverride | null
): RenderedEmail {
  if (override && Object.keys(override).length) {
    return renderCustomTemplate(key, variables, override)
  }
  const customerName = String(variables.customerName || '').trim()
  const greeting = customerName ? `Olá, ${customerName}.` : 'Olá.'
  const dashboardUrl = String(variables.dashboardUrl || appUrl())

  if (key === 'status_disconnected') {
    const numberName = String(variables.numberName || variables.phone || 'monitorado')
    const subject = `WhatsApp desconectado — ${numberName}`
    const text = `${greeting}\n\nO número ${numberName} foi desconectado. Acesse o painel para acompanhar a reconexão.`
    return {
      subject,
      text,
      html: layout({
        eyebrow: 'Alerta operacional',
        title: 'Uma conexão precisa de atenção',
        preheader: subject,
        contentHtml: paragraphs(text),
        buttonLabel: 'Abrir monitoramento',
        buttonUrl: dashboardUrl
      })
    }
  }

  if (key === 'status_reconnected') {
    const numberName = String(variables.numberName || variables.phone || 'monitorado')
    const subject = `WhatsApp reconectado — ${numberName}`
    const text = `${greeting}\n\nO número ${numberName} foi reconectado e voltou ao estado normal.`
    return {
      subject,
      text,
      html: layout({
        eyebrow: 'Conexão restabelecida',
        title: 'Operação normalizada',
        preheader: subject,
        contentHtml: paragraphs(text),
        buttonLabel: 'Ver no painel',
        buttonUrl: dashboardUrl
      })
    }
  }

  if (key === 'welcome') {
    const trialEndsAt = String(variables.trialEndsAt || '')
    const subject = 'Bem-vindo ao SNW — seu monitoramento já pode começar'
    const text = `${greeting}\n\nSeu workspace foi criado e seus 7 dias grátis começaram. Configure as integrações escolhidas para importar e monitorar suas instâncias.\n\n${trialEndsAt ? `Seu período gratuito termina em ${trialEndsAt}.` : ''}`
    return {
      subject,
      text,
      html: layout({
        eyebrow: 'Bem-vindo ao SNW',
        title: 'Sua operação ganhou uma camada de proteção',
        preheader: 'Configure suas integrações e comece a monitorar.',
        contentHtml: paragraphs(text),
        buttonLabel: 'Configurar meu workspace',
        buttonUrl: dashboardUrl
      })
    }
  }

  if (key === 'trial_ending') {
    const subject = 'Seu teste grátis do SNW termina em breve'
    const text = `${greeting}\n\nSeu período gratuito termina em ${String(variables.trialEndsAt || 'breve')}. Cadastre o cartão para manter o monitoramento e os alertas ativos sem interrupção.`
    return {
      subject,
      text,
      html: layout({
        eyebrow: 'Teste grátis',
        title: 'Continue protegido depois do período gratuito',
        preheader: subject,
        contentHtml: paragraphs(text),
        buttonLabel: 'Ativar minha assinatura',
        buttonUrl: `${dashboardUrl}/?section=subscription`
      })
    }
  }

  if (key === 'cart_recovery') {
    const subject = String(variables.subject || 'Conclua sua assinatura do SNW')
    const unsubscribe = String(variables.unsubscribeUrl || '')
    const text = `${greeting}\n\nSeu checkout ainda não foi concluído. Retome de onde parou para manter o monitoramento e os alertas da sua operação ativos.`
    return {
      subject,
      text: `${text}${unsubscribe ? `\n\nDescadastrar: ${unsubscribe}` : ''}`,
      html: layout({
        eyebrow: 'Assinatura pendente',
        title: 'Falta pouco para concluir',
        preheader: subject,
        contentHtml: paragraphs(text),
        buttonLabel: 'Continuar pagamento',
        buttonUrl: String(variables.checkoutUrl || dashboardUrl),
        footer: unsubscribe
          ? `Você recebeu este lembrete porque iniciou uma assinatura no SNW. <a href="${escapeHtml(unsubscribe)}" style="color:#74dcb3">Cancelar lembretes e comunicações comerciais</a>.`
          : undefined
      })
    }
  }

  if (key === 'campaign') {
    const subject = String(variables.subject || 'Novidades do SNW')
    const unsubscribeUrl = String(variables.unsubscribeUrl || '')
    const footer = unsubscribeUrl
      ? `Você recebeu esta comunicação por possuir uma conta no SNW. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#74dcb3">Cancelar comunicações comerciais</a>.`
      : 'Você recebeu esta comunicação por possuir uma conta no SNW.'
    const text = `${greeting}\n\n${String(variables.contentText || '')}${unsubscribeUrl ? `\n\nDescadastrar: ${unsubscribeUrl}` : ''}`
    return {
      subject,
      text,
      html: layout({
        eyebrow: String(variables.eyebrow || 'Novidades SNW'),
        title: String(variables.title || subject),
        preheader: String(variables.preheader || subject),
        contentHtml: paragraphs(`${greeting}\n\n${String(variables.contentText || '')}`),
        buttonLabel: variables.buttonLabel ? String(variables.buttonLabel) : undefined,
        buttonUrl: variables.buttonUrl ? String(variables.buttonUrl) : undefined,
        footer
      })
    }
  }

  const subject = String(variables.subject || 'Atualização da sua assinatura SNW')
  const text = `${greeting}\n\n${String(variables.message || '')}`
  return {
    subject,
    text,
    html: layout({
      eyebrow: 'Assinatura e cobrança',
      title: subject,
      preheader: subject,
      contentHtml: paragraphs(text),
      buttonLabel: variables.buttonUrl ? 'Ver cobrança' : 'Abrir o SNW',
      buttonUrl: String(variables.buttonUrl || `${dashboardUrl}/?section=payments`)
    })
  }
}
