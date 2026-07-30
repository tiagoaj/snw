import { useEffect, useState } from 'react'

type View = 'home' | 'login' | 'signup' | 'reset-password' | 'dashboard'
type DashboardSection = 'operation' | 'subscription' | 'payments' | 'emails' | 'campaigns'
type PlanId = 'start' | 'growth' | 'scale'
type CampaignAudience = 'all_clients' | 'active_subscribers' | 'trialing' | 'checkout_pending' | 'past_due'
type Workspace = { id: string; name: string; slug: string; monitoring_enabled?: boolean; auto_monitor_new_numbers?: boolean; notify_whatsapp?: string | null; notify_email?: string | null; notify_on_reconnect?: boolean }
type Client = {
  id: string
  name: string
  integration_platform: 'uazapi' | 'evolution' | 'waha'
  notify_email: string | null
  notify_whatsapp: string | null
  integration_config?: {
    baseUrl?: string
    apiKey?: string
    apiKeyConfigured?: boolean
    instanceName?: string
    sessionName?: string
  }
}
type UserProfile = { id: string; workspace_id: string; role: string }
type UserRow = { id: string; email: string; full_name?: string; role: string; status: string }
type WhatsappNumber = {
  id: string
  phone: string
  display_name?: string | null
  external_id?: string
  provider: string
  status: 'connected' | 'disconnected' | 'pending' | 'error'
  notify_to: string | null
  notify_channel: 'email' | 'whatsapp'
  last_seen_at: string | null
  last_checked_at?: string | null
  monitoring_enabled?: boolean
}
type NumberEvent = { id: string; event_type: string; created_at: string }
type Uptime = { percentage: number; incidents: number; days: number; current_status: string; last_checked_at: string | null }
type Integration = {
  id: string
  workspace_id: string
  provider: 'uazapi' | 'evolution' | 'waha'
  name: string
  base_url: string | null
  status: string
  last_sync_at: string | null
  last_sync_error: string | null
  credentials: { apiKeyConfigured?: boolean }
}
type BillingProfile = {
  name: string
  cpfCnpj: string
  phone: string
  address: string
  addressNumber: string
  complement: string
  postalCode: string
  province: string
  city: string
  state: string
  cityCode: string
}
type BillingSubscription = {
  id: string
  workspace_id: string
  plan_id: PlanId
  plan_name: string
  integration_limit: number
  amount_cents: number
  status: 'trialing' | 'checkout_pending' | 'active' | 'past_due' | 'canceled' | 'expired'
  trial_started_at: string | null
  trial_ends_at: string | null
  checkout_expires_at: string | null
  billing_profile: BillingProfile | null
  billing_access: {
    state: 'active' | 'trial' | 'grace' | 'blocked'
    operational_allowed: boolean
    communications_allowed: boolean
    grace_ends_at: string | null
    reason: string | null
  }
  last_payment_status: string | null
  next_due_date: string | null
  updated_at: string
}
type AdminSubscription = BillingSubscription & {
  created_at: string
  workspace: {
    id: string
    name: string
    slug: string
    created_at: string
  }
  account: {
    id: string
    full_name: string | null
    email: string
    status: string
  }
}
type AdminSubscriptionSummary = {
  total: number
  statuses: Record<string, number>
  plans: Record<PlanId, number>
}
type PaymentHistoryItem = {
  id: string
  asaas_payment_id: string | null
  event_type: string
  status: string
  description: string
  value: number
  billing_type: string
  due_date: string | null
  payment_date: string | null
  created_at: string
  invoice_url: string | null
}
type EmailCampaign = {
  id: string
  name: string
  audience: CampaignAudience
  subject: string
  status: 'draft' | 'queued' | 'sending' | 'completed' | 'failed' | 'canceled'
  total_recipients: number
  sent_count: number
  failed_count: number
  last_error: string | null
  created_at: string
}
type EmailTemplate = {
  key: string
  display_name: string
  category: string
  usage_description: string
  subject_template: string
  preheader_template: string
  eyebrow_template: string
  title_template: string
  content_template: string
  button_label_template: string
  button_url_template: string
  available_variables: string[]
  customized: boolean
  updated_at: string | null
}
type EmailMessage = {
  id: string
  recipient_email: string
  recipient_name: string | null
  category: string
  template_key: string
  subject: string
  status: string
  error_message: string | null
  sent_at: string | null
  delivered_at: string | null
  created_at: string
}
type EmailTemplateDraft = Pick<EmailTemplate,
  'subject_template' |
  'preheader_template' |
  'eyebrow_template' |
  'title_template' |
  'content_template' |
  'button_label_template' |
  'button_url_template'
>

function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip">
      <button type="button" className="info-tip-trigger" aria-label={`Informação: ${text}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10.8v5.4M12 7.6h.01" />
        </svg>
      </button>
      <span className="info-tip-content" role="tooltip">{text}</span>
    </span>
  )
}

const plans: Array<{ id: PlanId; name: string; integrations: number; price: string; description: string; featured?: boolean }> = [
  { id: 'start', name: 'Start', integrations: 1, price: '59,90', description: 'Para quem quer proteger uma operação principal.' },
  { id: 'growth', name: 'Growth', integrations: 2, price: '79,90', description: 'Mais flexibilidade com o melhor custo-benefício.', featured: true },
  { id: 'scale', name: 'Scale', integrations: 3, price: '99,90', description: 'Cobertura completa para operações multicanal.' }
]
const paymentStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  RECEIVED: 'Recebido',
  RECEIVED_IN_CASH: 'Recebido',
  OVERDUE: 'Vencido',
  REFUNDED: 'Estornado',
  REFUND_REQUESTED: 'Estorno solicitado',
  CHARGEBACK_REQUESTED: 'Chargeback',
  CHARGEBACK_DISPUTE: 'Em disputa',
  AWAITING_CHARGEBACK_REVERSAL: 'Reversão pendente',
  DUNNING_REQUESTED: 'Em recuperação',
  DUNNING_RECEIVED: 'Recuperado',
  AWAITING_RISK_ANALYSIS: 'Em análise'
}
const subscriptionStatusLabels: Record<string, string> = {
  trialing: 'Teste grátis',
  checkout_pending: 'Pagamento iniciado',
  active: 'Assinatura ativa',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
  expired: 'Teste expirado'
}
const billingTypeLabels: Record<string, string> = {
  CREDIT_CARD: 'Cartão de crédito',
  PIX: 'Pix',
  BOLETO: 'Boleto'
}
const providerLogoPath = {
  uazapi: '/integrations/uazapi.png',
  evolution: '/integrations/evolution.png',
  waha: '/integrations/waha.png'
}

function LandingPage({ onLogin, onTrial }: { onLogin: () => void; onTrial: (plan?: PlanId) => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const scrollTo = (id: string) => {
    setMobileMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
  const openLogin = () => {
    setMobileMenuOpen(false)
    onLogin()
  }
  const openTrial = () => {
    setMobileMenuOpen(false)
    onTrial()
  }

  useEffect(() => {
    if (!mobileMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileMenuOpen])

  return (
    <div className="landing">
      <header className="landing-nav">
        <button className="landing-brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="brand">SNW<span>•</span></span>
          <small>WhatsApp Operations</small>
        </button>
        <nav aria-label="Navegação principal">
          <button type="button" onClick={() => scrollTo('recursos')}>Recursos</button>
          <button type="button" onClick={() => scrollTo('como-funciona')}>Como funciona</button>
          <button type="button" onClick={() => scrollTo('planos')}>Planos</button>
        </nav>
        <div className="landing-nav-actions">
          <button className="landing-login" type="button" onClick={openLogin}>Entrar</button>
          <button className="landing-cta compact" type="button" onClick={openTrial}>Testar grátis</button>
          <button
            className={`landing-menu-toggle ${mobileMenuOpen ? 'open' : ''}`}
            type="button"
            aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="landing-mobile-menu"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <nav
          className={`landing-mobile-menu ${mobileMenuOpen ? 'open' : ''}`}
          id="landing-mobile-menu"
          aria-label="Navegação mobile"
          aria-hidden={!mobileMenuOpen}
        >
          <button type="button" onClick={() => scrollTo('recursos')}>Recursos</button>
          <button type="button" onClick={() => scrollTo('como-funciona')}>Como funciona</button>
          <button type="button" onClick={() => scrollTo('planos')}>Planos</button>
          <button className="mobile-login-link" type="button" onClick={openLogin}>Entrar na minha conta</button>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <div className="landing-pill"><span /> 7 dias grátis para colocar sua operação sob controle</div>
            <h1>Seu cliente não deveria descobrir sozinho que o <em>WhatsApp caiu.</em></h1>
            <p className="hero-lead">Monitore todas as instâncias em um único painel, receba alertas no momento da queda e transforme a reconexão em um fluxo simples — antes que a desconexão custe conversas, leads e confiança.</p>
            <div className="hero-actions">
              <button className="landing-cta" type="button" onClick={() => onTrial()}>Começar meus 7 dias grátis <span>→</span></button>
              <button className="landing-ghost" type="button" onClick={() => scrollTo('como-funciona')}>Ver como funciona</button>
            </div>
            <div className="hero-assurances">
              <span>✓ Instâncias ilimitadas</span>
              <span>✓ Configuração guiada</span>
              <span>✓ Planos a partir de R$ 59,90</span>
            </div>
          </div>

          <div className="hero-product" aria-label="Prévia do painel de monitoramento">
            <div className="product-glow" />
            <div className="product-window">
              <div className="product-top">
                <div><span className="product-logo">SNW<span>•</span></span><small>Central de operações</small></div>
                <span className="live-indicator"><i /> Monitoramento ativo</span>
              </div>
              <div className="product-metrics">
                <div><small>Números monitorados</small><strong>48</strong></div>
                <div><small>Conectados</small><strong className="product-green">46</strong></div>
                <div><small>Atenção agora</small><strong className="product-red">2</strong></div>
              </div>
              <div className="product-alert">
                <div className="alert-icon">!</div>
                <div><strong>Desconexão identificada</strong><small>Comercial 02 • UAZAPI</small></div>
                <span>agora</span>
              </div>
              <div className="product-table">
                <div className="product-row product-head"><span>Instância</span><span>Status</span><span>Monitorar</span></div>
                <div className="product-row"><span><i className="avatar">C1</i> Comercial 01</span><b className="mini-status ok">Conectado</b><b className="mini-toggle">Ativo</b></div>
                <div className="product-row"><span><i className="avatar">S</i> Suporte</span><b className="mini-status ok">Conectado</b><b className="mini-toggle">Ativo</b></div>
                <div className="product-row"><span><i className="avatar warning">C2</i> Comercial 02</span><b className="mini-status down">Desconectado</b><b className="mini-toggle">Ativo</b></div>
              </div>
            </div>
            <div className="floating-notice">
              <span>✓</span><div><strong>Alerta entregue</strong><small>Responsável técnico avisado</small></div>
            </div>
          </div>
        </section>

        <section className="provider-strip" aria-label="Integrações disponíveis">
          <p>Uma central. As plataformas que sua operação já usa.</p>
          <div className="provider-logos">
            <article>
              <span className="provider-logo uazapi"><img src="/integrations/uazapi.png" alt="" /></span>
              <span><strong>UAZAPI</strong><small>Integração disponível</small></span>
            </article>
            <article>
              <span className="provider-logo evolution"><img src="/integrations/evolution.png" alt="" /></span>
              <span><strong>EVOLUTION API</strong><small>Integração disponível</small></span>
            </article>
            <article>
              <span className="provider-logo waha"><img src="/integrations/waha.png" alt="" /></span>
              <span><strong>WAHA</strong><small>Integração disponível</small></span>
            </article>
            <div className="provider-unlimited"><b>∞</b><span><strong>Instâncias ilimitadas</strong><small>em qualquer plano</small></span></div>
          </div>
        </section>

        <section className="landing-section loss-section">
          <div className="section-kicker">O custo invisível da desconexão</div>
          <h2>Enquanto ninguém percebe a queda,<br /><em>a operação continua perdendo.</em></h2>
          <p>Uma instância offline não é apenas um ponto vermelho no sistema. Pode ser um atendimento parado, um lead sem resposta ou um cliente questionando a confiabilidade da sua empresa.</p>
          <div className="loss-grid">
            <article><span>01</span><h3>Conversas interrompidas</h3><p>O time acredita que está atendendo, mas as mensagens simplesmente deixam de chegar.</p></article>
            <article><span>02</span><h3>Diagnóstico atrasado</h3><p>Sem monitoramento, a equipe só reage quando alguém reclama — e o dano já aconteceu.</p></article>
            <article><span>03</span><h3>Reconexão improvisada</h3><p>QR Code, pareamento e responsáveis se perdem em um processo manual e demorado.</p></article>
          </div>
        </section>

        <section className="landing-section features-section" id="recursos">
          <div className="features-intro">
            <div><div className="section-kicker">Controle que trabalha por você</div><h2>Da queda à reconexão,<br /><em>sem depender da sorte.</em></h2></div>
            <p>O SNW acompanha o que acontece nas plataformas e aciona as pessoas certas com o próximo passo claro.</p>
          </div>
          <div className="feature-grid">
            <article className="feature-card featured-card"><div className="feature-icon">⌁</div><h3>Monitoramento em tempo real</h3><p>Visualize todas as instâncias, identifique quedas e acompanhe o status de cada número em uma única tela.</p><div className="feature-visual bars"><span /><span /><span /><span /></div></article>
            <article className="feature-card"><div className="feature-icon">↗</div><h3>Alertas inteligentes</h3><p>Avise o responsável técnico e o próprio cliente assim que uma desconexão for detectada.</p></article>
            <article className="feature-card"><div className="feature-icon">⌗</div><h3>Reconexão assistida</h3><p>O cliente escolhe QR Code ou código de pareamento respondendo apenas 1 ou 2 no WhatsApp.</p></article>
            <article className="feature-card"><div className="feature-icon">∞</div><h3>Instâncias ilimitadas</h3><p>Cadastre quantas instâncias precisar. Você paga pelas integrações, não pelo crescimento da operação.</p></article>
            <article className="feature-card"><div className="feature-icon">⇄</div><h3>Remetente de reserva</h3><p>Defina um número principal e outro de contingência para manter os alertas funcionando.</p></article>
            <article className="feature-card"><div className="feature-icon">◎</div><h3>Histórico operacional</h3><p>Acompanhe eventos, reconexões e disponibilidade para entender a saúde de cada operação.</p></article>
          </div>
        </section>

        <section className="landing-section steps-section" id="como-funciona">
          <div className="section-kicker">Simples de colocar para rodar</div>
          <h2>Três passos entre o caos<br />e uma operação <em>sob controle.</em></h2>
          <div className="steps-grid">
            <article><span>1</span><div><small>Conecte</small><h3>Adicione suas integrações</h3><p>Informe a URL e a credencial da UAZAPI, Evolution ou WAHA. O SNW importa as instâncias automaticamente.</p></div></article>
            <article><span>2</span><div><small>Defina</small><h3>Escolha regras e responsáveis</h3><p>Selecione o que monitorar, quem será avisado e quais números enviarão os alertas.</p></div></article>
            <article><span>3</span><div><small>Proteja</small><h3>Deixe o SNW vigiar por você</h3><p>Quando algo cair, o fluxo de alerta e reconexão começa sem depender de conferência manual.</p></div></article>
          </div>
        </section>

        <section className="landing-section comparison-section">
          <div className="comparison-copy">
            <div className="section-kicker">A diferença aparece na primeira queda</div>
            <h2>Você pode descobrir tarde.<br />Ou pode ser avisado <em>na hora.</em></h2>
            <p>Por menos que o custo de uma única oportunidade perdida, sua equipe ganha visão, processo e velocidade de resposta.</p>
            <button className="landing-cta" type="button" onClick={() => onTrial()}>Quero proteger minha operação <span>→</span></button>
          </div>
          <div className="comparison-cards">
            <article className="without"><small>Sem o SNW</small><ul><li>Cliente avisa que parou</li><li>Equipe procura qual instância caiu</li><li>Reconexão feita no improviso</li><li>Nenhum histórico centralizado</li></ul></article>
            <article className="with"><span className="recommended-label">Operação protegida</span><small>Com o SNW</small><ul><li>Alerta assim que desconecta</li><li>Status centralizado em tempo real</li><li>QR Code ou pareamento assistido</li><li>Instâncias ilimitadas</li></ul></article>
          </div>
        </section>

        <section className="landing-section faq-section">
          <div><div className="section-kicker">Sem letras miúdas</div><h2>Perguntas antes de<br /><em>começar.</em></h2></div>
          <div className="faq-list">
            <details><summary>Existe limite de números ou instâncias?</summary><p>Não. Em todos os planos, a quantidade de instâncias é ilimitada. A cobrança considera apenas quantas integrações diferentes o workspace utiliza.</p></details>
            <details><summary>O que conta como uma integração?</summary><p>Cada plataforma conectada conta como uma integração: UAZAPI, Evolution API ou WAHA. Dentro dela, você pode monitorar todas as instâncias importadas.</p></details>
            <details><summary>Como funcionam os 7 dias grátis?</summary><p>Você escolhe o plano, cria sua conta e pode validar o monitoramento na sua operação durante o período gratuito antes de seguir com a assinatura.</p></details>
            <details><summary>Preciso trocar minha plataforma atual?</summary><p>Não. O SNW funciona como uma central de monitoramento integrada às plataformas que você já utiliza.</p></details>
          </div>
        </section>

        <section className="pricing-section" id="planos">
          <div className="pricing-heading">
            <div className="section-kicker">Preço simples. Proteção sem limite de instâncias.</div>
            <h2>Escolha quantas integrações precisa.<br /><em>O resto é ilimitado.</em></h2>
            <p>Comece com 7 dias grátis e descubra o valor de saber antes que o cliente reclame.</p>
          </div>
          <div className="pricing-grid">
            {plans.map((plan) => (
              <article className={plan.featured ? 'price-card featured-price' : 'price-card'} key={plan.id}>
                {plan.featured && <span className="price-ribbon">Melhor custo-benefício</span>}
                <div className="price-top"><h3>{plan.name}</h3><span>{plan.integrations} {plan.integrations === 1 ? 'integração' : 'integrações'}</span></div>
                <p>{plan.description}</p>
                <div className="price"><small>R$</small><strong>{plan.price}</strong><span>/mês</span></div>
                <ul><li>7 dias grátis</li><li>Instâncias ilimitadas</li><li>Monitoramento em tempo real</li><li>Alertas e reconexão assistida</li><li>Painel responsivo</li></ul>
                <button className={plan.featured ? 'landing-cta' : 'landing-plan-button'} type="button" onClick={() => onTrial(plan.id)}>Testar {plan.name} grátis <span>→</span></button>
              </article>
            ))}
          </div>
          <div className="pricing-note"><span>✓</span> Sem cobrança por instância. Sua operação pode crescer sem aumentar a mensalidade do plano.</div>
        </section>
      </main>

      <footer className="landing-footer">
        <div><span className="brand">SNW<span>•</span></span><p>WhatsApp conectado. Operação protegida.</p></div>
        <button type="button" onClick={onLogin}>Acessar minha conta</button>
        <small>© {new Date().getFullYear()} SNW — WhatsApp Operations</small>
      </footer>
    </div>
  )
}

const phoneDigits = (value: string) => value.replace(/\D/g, '').slice(0, 15)
const billingDigits = (value: string) => value.replace(/\D/g, '')

function formatCpfCnpj(value: string) {
  const digits = billingDigits(value).slice(0, 14)
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2')
  }
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

function formatBillingPhone(value: string) {
  const digits = billingDigits(value).slice(0, 11)
  return digits
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{4,5})(\d{4})$/, '$1-$2')
}

function formatPostalCode(value: string) {
  return billingDigits(value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2')
}

function formatBillingDate(value: string | null) {
  if (!value) return '—'
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}

function formatWhatsappPhone(value: string) {
  const raw = phoneDigits(value)
  if (!raw) return ''

  const hasBrazilDdi = raw.startsWith('55')
  const national = hasBrazilDdi ? raw.slice(2, 13) : raw.slice(0, 11)
  const ddd = national.slice(0, 2)
  const local = national.slice(2)
  const localFormatted = local.length > 5
    ? `${local.slice(0, local.length === 8 ? 4 : 5)}-${local.slice(local.length === 8 ? 4 : 5)}`
    : local
  const number = `${ddd ? `(${ddd}${ddd.length === 2 ? ')' : ''}` : ''}${local ? ` ${localFormatted}` : ''}`
  return hasBrazilDdi ? `+55${number ? ` ${number}` : ''}` : number
}

function addBrazilDdiIfMissing(value: string) {
  const raw = phoneDigits(value)
  return formatWhatsappPhone(!raw.startsWith('55') && [10, 11].includes(raw.length) ? `55${raw}` : raw)
}

let sessionRefreshPromise: Promise<string> | null = null

async function refreshAccessToken() {
  if (sessionRefreshPromise) return sessionRefreshPromise
  sessionRefreshPromise = (async () => {
    const refreshToken = localStorage.getItem('snw_refresh_token')
    if (!refreshToken) throw new Error('Sua sessão expirou. Entre novamente para continuar.')
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.session?.access_token || !data.session?.refresh_token) {
      throw new Error('Sua sessão expirou. Entre novamente para continuar.')
    }
    localStorage.setItem('snw_token', data.session.access_token)
    localStorage.setItem('snw_refresh_token', data.session.refresh_token)
    return data.session.access_token as string
  })()
  try {
    return await sessionRefreshPromise
  } catch (error) {
    localStorage.removeItem('snw_token')
    localStorage.removeItem('snw_refresh_token')
    window.dispatchEvent(new Event('snw:session-expired'))
    throw error
  } finally {
    sessionRefreshPromise = null
  }
}

const api = async (path: string, token = '', init: RequestInit = {}) => {
  const request = async (accessToken: string) => {
    const headers = new Headers(init.headers)
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    if (init.body) headers.set('Content-Type', 'application/json')
    try {
      return await fetch(path, { ...init, headers })
    } catch {
      throw new Error('Não foi possível conectar ao servidor. Verifique se o backend está rodando na porta 4000.')
    }
  }

  let accessToken = token ? localStorage.getItem('snw_token') || token : ''
  let response = await request(accessToken)
  if (response.status === 401 && accessToken) {
    if (localStorage.getItem('snw_refresh_token')) {
      accessToken = await refreshAccessToken()
      response = await request(accessToken)
    } else {
      localStorage.removeItem('snw_token')
      window.dispatchEvent(new Event('snw:session-expired'))
      throw new Error('Sua sessão expirou. Entre novamente para continuar.')
    }
  }
  const responseText = await response.text()
  let data: any = {}
  if (responseText) {
    try {
      data = JSON.parse(responseText)
    } catch {
      const readableResponse = responseText
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240)
      throw new Error(
        readableResponse
          ? `Erro HTTP ${response.status}: ${readableResponse}`
          : `O servidor retornou uma resposta inválida (HTTP ${response.status}).`
      )
    }
  }
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação')
  return data
}

function App() {
  const [view, setView] = useState<View>('home')
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryToken, setRecoveryToken] = useState('')
  const [fullName, setFullName] = useState('')
  const [signupCompany, setSignupCompany] = useState('')
  const [signupProviders, setSignupProviders] = useState<Array<'uazapi' | 'evolution' | 'waha'>>([])
  const [token, setToken] = useState('')
  const [user, setUser] = useState<UserRow | null>(null)
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [numbers, setNumbers] = useState<WhatsappNumber[]>([])
  const [selectedNumber, setSelectedNumber] = useState<WhatsappNumber | null>(null)
  const [numberEvents, setNumberEvents] = useState<NumberEvent[]>([])
  const [uptime, setUptime] = useState<Uptime | null>(null)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [workspaceNumbers, setWorkspaceNumbers] = useState<WhatsappNumber[]>([])
  const [workspaceNumberSearch, setWorkspaceNumberSearch] = useState('')
  const [workspaceNumberPageSize, setWorkspaceNumberPageSize] = useState<25 | 50 | 100>(50)
  const [workspaceNumberPage, setWorkspaceNumberPage] = useState(1)
  const [openNumberActionsId, setOpenNumberActionsId] = useState<string | null>(null)
  const [manualReconnectLoading, setManualReconnectLoading] = useState<string | null>(null)
  const [processingOverlay, setProcessingOverlay] = useState<{
    title: string
    detail: string
  } | null>(null)
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)
  const [customerCompany, setCustomerCompany] = useState('')
  const [customerSlug, setCustomerSlug] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPassword, setCustomerPassword] = useState('')
  const [customerProviders, setCustomerProviders] = useState<Array<'uazapi' | 'evolution' | 'waha'>>([])
  const [notificationSenders, setNotificationSenders] = useState<any[]>([])
  const [primarySenderId, setPrimarySenderId] = useState('')
  const [fallbackSenderId, setFallbackSenderId] = useState('')
  const [savedPrimarySenderId, setSavedPrimarySenderId] = useState('')
  const [savedFallbackSenderId, setSavedFallbackSenderId] = useState('')
  const [workspaceNotifyWhatsapp, setWorkspaceNotifyWhatsapp] = useState('')
  const [workspaceNotifyEmail, setWorkspaceNotifyEmail] = useState('')
  const [billingSubscription, setBillingSubscription] = useState<BillingSubscription | null>(null)
  const [billingPlanId, setBillingPlanId] = useState<PlanId>('growth')
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState('')
  const [adminSubscriptions, setAdminSubscriptions] = useState<AdminSubscription[]>([])
  const [adminSubscriptionSummary, setAdminSubscriptionSummary] = useState<AdminSubscriptionSummary>({
    total: 0,
    statuses: {},
    plans: { start: 0, growth: 0, scale: 0 }
  })
  const [adminSubscriptionsLoading, setAdminSubscriptionsLoading] = useState(false)
  const [adminSubscriptionsError, setAdminSubscriptionsError] = useState('')
  const [adminSubscriptionSearch, setAdminSubscriptionSearch] = useState('')
  const [adminSubscriptionStatus, setAdminSubscriptionStatus] = useState('all')
  const [adminSubscriptionPlan, setAdminSubscriptionPlan] = useState<'all' | PlanId>('all')
  const [dashboardSection, setDashboardSection] = useState<DashboardSection>('operation')
  const [payments, setPayments] = useState<PaymentHistoryItem[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [paymentsError, setPaymentsError] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [cepError, setCepError] = useState('')
  const [billingProfile, setBillingProfile] = useState<BillingProfile>({
    name: '',
    cpfCnpj: '',
    phone: '',
    address: '',
    addressNumber: '',
    complement: '',
    postalCode: '',
    province: '',
    city: '',
    state: '',
    cityCode: ''
  })
  const [pendingUsers, setPendingUsers] = useState<UserRow[]>([])
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([])
  const [selectedEmailTemplateKey, setSelectedEmailTemplateKey] = useState('')
  const [emailTemplateDraft, setEmailTemplateDraft] = useState<EmailTemplateDraft | null>(null)
  const [emailTemplateLoading, setEmailTemplateLoading] = useState(false)
  const [emailMessages, setEmailMessages] = useState<EmailMessage[]>([])
  const [emailCampaigns, setEmailCampaigns] = useState<EmailCampaign[]>([])
  const [emailCampaignLoading, setEmailCampaignLoading] = useState(false)
  const [emailAudienceCount, setEmailAudienceCount] = useState<number | null>(null)
  const [emailCampaignForm, setEmailCampaignForm] = useState({
    name: '',
    audience: 'all_clients' as CampaignAudience,
    subject: '',
    preheader: '',
    contentText: '',
    buttonLabel: '',
    buttonUrl: '',
    testEmail: ''
  })
  const [message, setMessage] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPlatform, setClientPlatform] = useState<Client['integration_platform']>('uazapi')
  const [clientEmail, setClientEmail] = useState('')
  const [clientWhatsapp, setClientWhatsapp] = useState('')
  const [integrationBaseUrl, setIntegrationBaseUrl] = useState('')
  const [integrationApiKey, setIntegrationApiKey] = useState('')
  const [integrationIdentifier, setIntegrationIdentifier] = useState('')
  const [numberPhone, setNumberPhone] = useState('')
  const [numberNotifyTo, setNumberNotifyTo] = useState('')
  const [numberNotifyChannel, setNumberNotifyChannel] = useState<'email' | 'whatsapp'>('whatsapp')

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (hash.get('type') === 'recovery' && hash.get('access_token')) {
      setRecoveryToken(hash.get('access_token')!)
      setView('reset-password')
      return
    }
    const billingResult = new URLSearchParams(window.location.search).get('billing')
    const requestedSection = new URLSearchParams(window.location.search).get('section')
    if (requestedSection && ['operation', 'subscription', 'payments', 'emails', 'campaigns'].includes(requestedSection)) {
      setDashboardSection(requestedSection as DashboardSection)
    }
    if (billingResult) {
      const messages: Record<string, string> = {
        success: 'Dados de pagamento enviados. Aguardando a confirmação segura do Asaas.',
        cancel: 'Checkout cancelado. Nenhuma cobrança foi confirmada.',
        expired: 'O checkout expirou. Você pode gerar um novo link no painel.'
      }
      setMessage(messages[billingResult] || 'Retorno do pagamento recebido.')
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`)
    }
    const saved = localStorage.getItem('snw_token')
    if (saved) {
      setToken(saved)
      setView('dashboard')
    }
  }, [])

  useEffect(() => {
    const handleSessionExpired = () => {
      logout()
      setMessage('Sua sessão expirou. Entre novamente para continuar.')
    }
    window.addEventListener('snw:session-expired', handleSessionExpired)
    return () => window.removeEventListener('snw:session-expired', handleSessionExpired)
  }, [])

  useEffect(() => {
    if (!token) return
    localStorage.setItem('snw_token', token)
    void loadSession()
  }, [token])

  useEffect(() => {
    if (!selectedWorkspace) return
    sessionStorage.setItem(
      `snw_billing_draft:${selectedWorkspace.id}`,
      JSON.stringify(billingProfile)
    )
  }, [billingProfile, selectedWorkspace?.id])

  useEffect(() => {
    if (view !== 'dashboard' || !message) return
    const timeout = window.setTimeout(() => setMessage(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [message, view])

  useEffect(() => {
    if (!openNumberActionsId) return
    const closeActions = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-number-actions]')) {
        setOpenNumberActionsId(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenNumberActionsId(null)
    }
    document.addEventListener('click', closeActions)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', closeActions)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openNumberActionsId])

  useEffect(() => {
    if (
      view !== 'dashboard' ||
      dashboardSection !== 'operation' ||
      !selectedWorkspace?.id ||
      !token
    ) return
    let disposed = false
    const refreshWorkspaceNumbers = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const data = await api(`/api/workspace-numbers?workspace_id=${selectedWorkspace.id}`, token)
        if (!disposed) setWorkspaceNumbers(data.numbers || [])
      } catch {
        // A atualização silenciosa não substitui os avisos das ações do usuário.
      }
    }
    const interval = window.setInterval(refreshWorkspaceNumbers, 8_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshWorkspaceNumbers()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      disposed = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [view, dashboardSection, selectedWorkspace?.id, token])

  async function loadSession() {
    try {
      const me = await api('/api/auth/me', token)
      setUser(me.userRow)
      setProfiles(me.profiles ?? [])
    } catch (error) {
      setMessage((error as Error).message)
      logout()
      return
    }

    try {
      const workspaceData = await api('/api/workspaces/me', token)
      setWorkspaces(workspaceData.workspaces)
      if (workspaceData.workspaces.length) await selectWorkspace(workspaceData.workspaces[0])
      const currentUser = await api('/api/auth/me', token)
      if (currentUser.userRow.role === 'superadmin') {
        await Promise.all([loadPendingUsers(), loadAdminSubscriptions()])
      }
    } catch (error) {
      setMessage(`Sessão iniciada, mas o painel não carregou: ${(error as Error).message}`)
    }
  }

  async function login() {
    setMessage('')
    try {
      const data = await api('/api/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      })
      localStorage.setItem('snw_refresh_token', data.session.refresh_token)
      setToken(data.session.access_token)
      setView('dashboard')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function signup() {
    setMessage('')
    const currentPlan = plans.find((plan) => plan.id === selectedPlan)
    if (!fullName || !signupCompany || !email || password.length < 6) {
      return setMessage('Preencha empresa, nome, e-mail e uma senha com pelo menos 6 caracteres')
    }
    if (!currentPlan || signupProviders.length !== currentPlan.integrations) {
      return setMessage(`Selecione exatamente ${currentPlan?.integrations || 1} integração(ões) para o plano escolhido`)
    }
    try {
      await api('/api/auth/signup', '', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName,
          company_name: signupCompany,
          email,
          password,
          selected_plan: selectedPlan,
          providers: signupProviders
        })
      })
      const loginData = await api('/api/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      })
      setPassword('')
      localStorage.setItem('snw_refresh_token', loginData.session.refresh_token)
      setToken(loginData.session.access_token)
      setView('dashboard')
      setMessage('Conta e workspace criados. Seus 7 dias grátis começaram agora.')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function resetPassword() {
    setMessage('')
    if (password.length < 8) return setMessage('A nova senha precisa ter pelo menos 8 caracteres')
    try {
      await api('/api/auth/reset-password', '', {
        method: 'POST',
        body: JSON.stringify({ access_token: recoveryToken, password })
      })
      window.history.replaceState({}, document.title, window.location.pathname)
      setRecoveryToken('')
      setPassword('')
      setView('login')
      setMessage('Senha alterada com sucesso. Entre com a nova senha.')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function requestPasswordRecovery() {
    setMessage('')
    if (!email) return setMessage('Informe seu e-mail para recuperar a senha')
    try {
      const data = await api('/api/auth/forgot-password', '', {
        method: 'POST',
        body: JSON.stringify({ email })
      })
      setMessage(data.message)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function loadPendingUsers() {
    const data = await api('/api/users/pending', token)
    setPendingUsers(data.users)
  }

  function draftFromEmailTemplate(template: EmailTemplate): EmailTemplateDraft {
    return {
      subject_template: template.subject_template,
      preheader_template: template.preheader_template,
      eyebrow_template: template.eyebrow_template,
      title_template: template.title_template,
      content_template: template.content_template,
      button_label_template: template.button_label_template,
      button_url_template: template.button_url_template
    }
  }

  function selectEmailTemplate(template: EmailTemplate) {
    setSelectedEmailTemplateKey(template.key)
    setEmailTemplateDraft(draftFromEmailTemplate(template))
  }

  async function loadEmailTemplates() {
    setEmailTemplateLoading(true)
    try {
      const [templateData, messageData] = await Promise.all([
        api('/api/admin/email-templates', token),
        api('/api/admin/email-messages?limit=100', token)
      ])
      const templates = (templateData.templates || []) as EmailTemplate[]
      setEmailTemplates(templates)
      setEmailMessages(messageData.messages || [])
      const selected = templates.find((item) => item.key === selectedEmailTemplateKey) || templates[0]
      if (selected) selectEmailTemplate(selected)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setEmailTemplateLoading(false)
    }
  }

  async function saveEmailTemplate() {
    if (!selectedEmailTemplateKey || !emailTemplateDraft) return
    setEmailTemplateLoading(true)
    try {
      const data = await api(`/api/admin/email-templates/${selectedEmailTemplateKey}`, token, {
        method: 'PUT',
        body: JSON.stringify(emailTemplateDraft)
      })
      const updated = data.template as EmailTemplate
      setEmailTemplates((current) => current.map((item) => item.key === updated.key ? updated : item))
      selectEmailTemplate(updated)
      setMessage('Modelo de e-mail salvo com sucesso')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setEmailTemplateLoading(false)
    }
  }

  async function resetEmailTemplate() {
    if (!selectedEmailTemplateKey || !window.confirm('Restaurar este e-mail para o texto padrão do sistema?')) return
    setEmailTemplateLoading(true)
    try {
      const data = await api(`/api/admin/email-templates/${selectedEmailTemplateKey}`, token, {
        method: 'DELETE'
      })
      const restored = data.template as EmailTemplate
      setEmailTemplates((current) => current.map((item) => item.key === restored.key ? restored : item))
      selectEmailTemplate(restored)
      setMessage('Modelo padrão restaurado com sucesso')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setEmailTemplateLoading(false)
    }
  }

  async function loadEmailCampaigns() {
    try {
      const data = await api('/api/admin/email-campaigns', token)
      setEmailCampaigns(data.campaigns || [])
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function loadEmailAudienceCount(audience = emailCampaignForm.audience) {
    try {
      const data = await api(`/api/admin/email-campaigns/audience-count?audience=${audience}`, token)
      setEmailAudienceCount(data.count)
    } catch (error) {
      setEmailAudienceCount(null)
      setMessage((error as Error).message)
    }
  }

  async function sendEmailCampaignTest() {
    setEmailCampaignLoading(true)
    try {
      await api('/api/admin/email-campaigns/test', token, {
        method: 'POST',
        body: JSON.stringify({
          test_email: emailCampaignForm.testEmail,
          subject: emailCampaignForm.subject,
          preheader: emailCampaignForm.preheader,
          content_text: emailCampaignForm.contentText,
          button_label: emailCampaignForm.buttonLabel,
          button_url: emailCampaignForm.buttonUrl
        })
      })
      setMessage('E-mail de teste enviado com sucesso')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setEmailCampaignLoading(false)
    }
  }

  async function createEmailCampaignFromPanel() {
    if (!window.confirm(`Enviar esta campanha para ${emailAudienceCount ?? 'os'} destinatários elegíveis?`)) return
    setEmailCampaignLoading(true)
    try {
      await api('/api/admin/email-campaigns', token, {
        method: 'POST',
        body: JSON.stringify({
          name: emailCampaignForm.name,
          audience: emailCampaignForm.audience,
          subject: emailCampaignForm.subject,
          preheader: emailCampaignForm.preheader,
          content_text: emailCampaignForm.contentText,
          button_label: emailCampaignForm.buttonLabel,
          button_url: emailCampaignForm.buttonUrl
        })
      })
      setMessage('Campanha criada e adicionada à fila de envio com sucesso')
      setEmailCampaignForm((current) => ({
        ...current,
        name: '',
        subject: '',
        preheader: '',
        contentText: '',
        buttonLabel: '',
        buttonUrl: ''
      }))
      await loadEmailCampaigns()
      await loadEmailAudienceCount()
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setEmailCampaignLoading(false)
    }
  }

  async function loadNotificationSettings(workspaceId: string) {
    const data = await api(`/api/workspaces/${workspaceId}/notification-settings`, token)
    setNotificationSenders(data.senders)
    setPrimarySenderId(data.settings?.primary_sender_id || '')
    setFallbackSenderId(data.settings?.fallback_sender_id || '')
    setSavedPrimarySenderId(data.settings?.primary_sender_id || '')
    setSavedFallbackSenderId(data.settings?.fallback_sender_id || '')
  }

  async function loadBilling(workspaceId: string) {
    setBillingError('')
    setCepError('')
    setBillingSubscription(null)
    try {
      const data = await api(`/api/billing/subscription?workspace_id=${workspaceId}`, token)
      setBillingSubscription(data.subscription)
      if (data.subscription?.plan_id) setBillingPlanId(data.subscription.plan_id)
      if (data.subscription?.billing_profile) {
        const profile = data.subscription.billing_profile
        setBillingProfile({
          name: profile.name || data.billing_contact?.name || '',
          cpfCnpj: formatCpfCnpj(profile.cpfCnpj || ''),
          phone: formatBillingPhone(profile.phone || ''),
          address: profile.address || '',
          addressNumber: profile.addressNumber || '',
          complement: profile.complement || '',
          postalCode: formatPostalCode(profile.postalCode || ''),
          province: profile.province || '',
          city: profile.city || '',
          state: profile.state || '',
          cityCode: profile.cityCode || ''
        })
      } else {
        const savedDraft = sessionStorage.getItem(`snw_billing_draft:${workspaceId}`)
        if (savedDraft) {
          try {
            setBillingProfile({
              name: data.billing_contact?.name || '',
              cpfCnpj: '',
              phone: '',
              address: '',
              addressNumber: '',
              complement: '',
              postalCode: '',
              province: '',
              city: '',
              state: '',
              cityCode: '',
              ...JSON.parse(savedDraft)
            })
          } catch {
            sessionStorage.removeItem(`snw_billing_draft:${workspaceId}`)
          }
        } else {
          setBillingProfile({
            name: data.billing_contact?.name || '',
            cpfCnpj: '',
            phone: '',
            address: '',
            addressNumber: '',
            complement: '',
            postalCode: '',
            province: '',
            city: '',
            state: '',
            cityCode: ''
          })
        }
      }
    } catch (error) {
      setBillingError((error as Error).message)
    }
  }

  async function loadAdminSubscriptions() {
    setAdminSubscriptionsLoading(true)
    setAdminSubscriptionsError('')
    try {
      const data = await api('/api/admin/subscriptions', token)
      setAdminSubscriptions(data.subscriptions || [])
      setAdminSubscriptionSummary(data.summary || {
        total: 0,
        statuses: {},
        plans: { start: 0, growth: 0, scale: 0 }
      })
    } catch (error) {
      setAdminSubscriptions([])
      setAdminSubscriptionsError((error as Error).message)
    } finally {
      setAdminSubscriptionsLoading(false)
    }
  }

  async function loadPayments(workspaceId: string) {
    setPaymentsLoading(true)
    setPaymentsError('')
    try {
      const data = await api(`/api/billing/payments?workspace_id=${workspaceId}`, token)
      setPayments(data.payments || [])
    } catch (error) {
      setPayments([])
      setPaymentsError((error as Error).message)
    } finally {
      setPaymentsLoading(false)
    }
  }

  async function approveUser(userId: string, approve: boolean) {
    try {
      await api('/api/users/approve', token, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, approve })
      })
      setPendingUsers((current) => current.filter((item) => item.id !== userId))
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function selectWorkspace(workspace: Workspace) {
    setSelectedWorkspace(workspace)
    setWorkspaceNumberSearch('')
    setWorkspaceNumberPage(1)
    setWorkspaceNotifyWhatsapp(formatWhatsappPhone(workspace.notify_whatsapp || ''))
    setWorkspaceNotifyEmail(workspace.notify_email || '')
    setSelectedClient(null)
    setNumbers([])
    const [clientData, integrationData, numberData] = await Promise.all([
      api(`/api/clients?workspace_id=${workspace.id}`, token),
      api(`/api/integrations?workspace_id=${workspace.id}`, token),
      api(`/api/workspace-numbers?workspace_id=${workspace.id}`, token)
    ])
    setClients(clientData.clients)
    setIntegrations(integrationData.integrations)
    setWorkspaceNumbers(numberData.numbers)
    await loadNotificationSettings(workspace.id)
    await loadBilling(workspace.id)
    await loadPayments(workspace.id)
  }

  async function lookupBillingCep(postalCode = billingProfile.postalCode) {
    const normalizedCep = billingDigits(postalCode)
    if (normalizedCep.length !== 8) {
      setCepError(normalizedCep ? 'Informe os 8 dígitos do CEP.' : '')
      return
    }
    setCepLoading(true)
    setCepError('')
    try {
      const data = await api(`/api/address/cep/${normalizedCep}`, token)
      const address = data.address
      setBillingProfile((current) => ({
        ...current,
        postalCode: formatPostalCode(address.postalCode || normalizedCep),
        address: address.address || current.address,
        province: address.province || current.province,
        city: address.city || '',
        state: address.state || '',
        cityCode: address.cityCode || ''
      }))
    } catch (error) {
      setCepError((error as Error).message)
      setBillingProfile((current) => ({ ...current, city: '', state: '', cityCode: '' }))
    } finally {
      setCepLoading(false)
    }
  }

  async function startAsaasCheckout() {
    if (!selectedWorkspace) return
    setBillingLoading(true)
    setBillingError('')
    try {
      const data = await api('/api/billing/checkout', token, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: selectedWorkspace.id,
          plan_id: billingPlanId,
          billing_profile: billingProfile
        })
      })
      if (!data.checkoutUrl) throw new Error('O servidor não retornou o link de pagamento')
      window.location.assign(data.checkoutUrl)
    } catch (error) {
      setBillingError((error as Error).message)
      setBillingLoading(false)
    }
  }

  async function saveWorkspaceMonitoring(updates: Record<string, unknown>) {
    if (!selectedWorkspace) return
    const enteredWhatsapp = phoneDigits(workspaceNotifyWhatsapp)
    const normalizedWhatsapp = !enteredWhatsapp.startsWith('55') && [10, 11].includes(enteredWhatsapp.length)
      ? `55${enteredWhatsapp}`
      : enteredWhatsapp
    if (normalizedWhatsapp && (normalizedWhatsapp.length < 12 || normalizedWhatsapp.length > 15)) {
      return setMessage('Informe o WhatsApp com DDI, DDD e número. Exemplo: +55 (11) 99999-9999')
    }
    try {
      const data = await api(`/api/workspaces/${selectedWorkspace.id}/monitoring`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          notify_whatsapp: normalizedWhatsapp || null,
          notify_email: workspaceNotifyEmail || null,
          ...updates
        })
      })
      setSelectedWorkspace(data.workspace)
      setWorkspaceNotifyWhatsapp(formatWhatsappPhone(data.workspace.notify_whatsapp || ''))
      setWorkspaces((current) => current.map((item) => item.id === data.workspace.id ? data.workspace : item))
      setMessage('Configurações de monitoramento salvas com sucesso')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function toggleNumberMonitoring(number: WhatsappNumber) {
    try {
      const data = await api(`/api/numbers/${number.id}/monitoring`, token, {
        method: 'PATCH',
        body: JSON.stringify({ monitoring_enabled: number.monitoring_enabled === false })
      })
      setWorkspaceNumbers((current) => current.map((item) => item.id === number.id ? data.number : item))
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function sendManualReconnect(number: WhatsappNumber, method: 'qr' | 'pairing') {
    const actionKey = `${number.id}:${method}`
    setManualReconnectLoading(actionKey)
    setOpenNumberActionsId(null)
    setProcessingOverlay({
      title: method === 'qr' ? 'Gerando QR Code' : 'Gerando código de pareamento',
      detail: `Aguarde enquanto consultamos a ${number.provider.toUpperCase()} e enviamos o acesso para ${number.display_name || number.phone}.`
    })
    try {
      const data = await api(`/api/numbers/${number.id}/reconnect-authentication`, token, {
        method: 'POST',
        body: JSON.stringify({ method })
      })
      if (data.result.number) {
        setWorkspaceNumbers((current) => current.map((item) =>
          item.id === number.id ? data.result.number : item
        ))
      }
      if (data.result.skipped) {
        setMessage(data.result.message || 'A autenticação não foi gerada porque a conexão já foi restabelecida.')
        return
      }
      const label = method === 'qr' ? 'QR Code' : 'Código de pareamento'
      setMessage(`${label} gerado e enviado com sucesso para ${data.result.recipient_phone}`)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setManualReconnectLoading(null)
      setProcessingOverlay(null)
    }
  }

  async function saveNotificationSenders() {
    if (!selectedWorkspace) return
    try {
      const data = await api(`/api/workspaces/${selectedWorkspace.id}/notification-settings`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          primary_sender_id: primarySenderId || null,
          fallback_sender_id: fallbackSenderId || null
        })
      })
      setSavedPrimarySenderId(data.settings?.primary_sender_id || '')
      setSavedFallbackSenderId(data.settings?.fallback_sender_id || '')
      setMessage('Remetentes de notificação salvos com sucesso')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function provisionCustomer() {
    try {
      const data = await api('/api/admin/customers', token, {
        method: 'POST',
        body: JSON.stringify({
          company_name: customerCompany,
          slug: customerSlug,
          full_name: customerName,
          email: customerEmail,
          password: customerPassword,
          providers: customerProviders
        })
      })
      setWorkspaces((current) => [...current, data.workspace])
      setCustomerCompany(''); setCustomerSlug(''); setCustomerName('')
      setCustomerEmail(''); setCustomerPassword(''); setCustomerProviders([])
      await selectWorkspace(data.workspace)
      setMessage('Cliente e acesso criados com sucesso')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function configureNewIntegration() {
    if (!selectedIntegration) return
    setProcessingOverlay({
      title: `Conectando ${selectedIntegration.provider.toUpperCase()}`,
      detail: 'Estamos validando as credenciais e importando todas as instâncias disponíveis.'
    })
    try {
      await api(`/api/integrations/${selectedIntegration.id}/configure`, token, {
        method: 'PATCH',
        body: JSON.stringify({ base_url: integrationBaseUrl, api_key: integrationApiKey })
      })
      if (selectedWorkspace) await selectWorkspace(selectedWorkspace)
      setIntegrationApiKey('')
      setMessage('Integração conectada e números sincronizados')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setProcessingOverlay(null)
    }
  }

  async function syncSelectedIntegration(integration: Integration) {
    setProcessingOverlay({
      title: `Sincronizando ${integration.provider.toUpperCase()}`,
      detail: 'Estamos buscando as instâncias e atualizando os números e estados de conexão.'
    })
    try {
      await api(`/api/integrations/${integration.id}/sync`, token, { method: 'POST' })
      if (selectedWorkspace) await selectWorkspace(selectedWorkspace)
      setMessage('Sincronização concluída')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setProcessingOverlay(null)
    }
  }

  async function selectClient(client: Client) {
    setSelectedClient(client)
    setSelectedNumber(null)
    setNumberEvents([])
    setUptime(null)
    const data = await api(`/api/clients/${client.id}/numbers`, token)
    setNumbers(data.numbers)
  }

  async function selectNumber(number: WhatsappNumber) {
    setSelectedNumber(number)
    try {
      const [eventsData, uptimeData] = await Promise.all([
        api(`/api/numbers/${number.id}/events`, token),
        api(`/api/numbers/${number.id}/uptime?days=30`, token)
      ])
      setNumberEvents(eventsData.events)
      setUptime(uptimeData.uptime)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function createWorkspace() {
    try {
      const data = await api('/api/workspaces', token, {
        method: 'POST',
        body: JSON.stringify({ name: workspaceName, slug: workspaceSlug })
      })
      setWorkspaces((current) => [...current, data.workspace])
      setWorkspaceName('')
      setWorkspaceSlug('')
      await selectWorkspace(data.workspace)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function createClient() {
    if (!selectedWorkspace) return
    try {
      const data = await api('/api/clients', token, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: selectedWorkspace.id,
          name: clientName,
          integration_platform: clientPlatform,
          notify_email: clientEmail || null,
          notify_whatsapp: clientWhatsapp || null
        })
      })
      setClients((current) => [...current, data.client])
      setClientName('')
      setClientEmail('')
      setClientWhatsapp('')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function createNumber() {
    if (!selectedClient) return
    try {
      const data = await api(`/api/clients/${selectedClient.id}/numbers`, token, {
        method: 'POST',
        body: JSON.stringify({
          phone: numberPhone,
          notify_to: numberNotifyTo || null,
          notify_channel: numberNotifyChannel
        })
      })
      setNumbers((current) => [data.number, ...current])
      setNumberPhone('')
      setNumberNotifyTo('')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function saveIntegration() {
    if (!selectedClient) return
    try {
      const identifier = selectedClient.integration_platform === 'evolution'
        ? { instanceName: integrationIdentifier }
        : selectedClient.integration_platform === 'waha'
          ? { sessionName: integrationIdentifier }
          : {}
      const data = await api(`/api/clients/${selectedClient.id}/integration`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          integration_config: {
            baseUrl: integrationBaseUrl,
            apiKey: integrationApiKey || undefined,
            ...identifier
          }
        })
      })
      setClients((current) => current.map((client) => client.id === data.client.id ? data.client : client))
      setSelectedClient(data.client)
      setIntegrationApiKey('')
      setMessage('Integração salva com sucesso')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  function logout() {
    localStorage.removeItem('snw_token')
    localStorage.removeItem('snw_refresh_token')
    setToken('')
    setUser(null)
    setProfiles([])
    setWorkspaces([])
    setSelectedWorkspace(null)
    setSelectedClient(null)
    setSelectedNumber(null)
    setClients([])
    setNumbers([])
    setIntegrations([])
    setWorkspaceNumbers([])
    setBillingSubscription(null)
    setBillingError('')
    setAdminSubscriptions([])
    setAdminSubscriptionSummary({ total: 0, statuses: {}, plans: { start: 0, growth: 0, scale: 0 } })
    setAdminSubscriptionsError('')
    setAdminSubscriptionSearch('')
    setAdminSubscriptionStatus('all')
    setAdminSubscriptionPlan('all')
    setDashboardSection('operation')
    setPayments([])
    setPaymentsError('')
    setEmailTemplates([])
    setSelectedEmailTemplateKey('')
    setEmailTemplateDraft(null)
    setEmailMessages([])
    setEmailCampaigns([])
    setEmailAudienceCount(null)
    setView('login')
  }

  function startTrial(plan: PlanId = 'growth') {
    setSelectedPlan(plan)
    setSignupProviders([])
    localStorage.setItem('snw_selected_plan', plan)
    setMessage('')
    setView('signup')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const canManage = user?.role === 'superadmin' || (!!selectedWorkspace && profiles.some(
    (profile) => profile.workspace_id === selectedWorkspace.id && profile.role === 'workspace_admin'
  ))
  const selectedEmailTemplate = emailTemplates.find((item) => item.key === selectedEmailTemplateKey) || null
  const operationBlocked = user?.role !== 'superadmin' &&
    billingSubscription?.billing_access?.state === 'blocked'
  const billingInGrace = user?.role !== 'superadmin' &&
    billingSubscription?.billing_access?.state === 'grace'
  const adminSubscriberQuery = adminSubscriptionSearch.trim().toLowerCase()
  const filteredAdminSubscriptions = adminSubscriptions.filter((subscription) => {
    const matchesSearch = !adminSubscriberQuery ||
      subscription.workspace.name.toLowerCase().includes(adminSubscriberQuery) ||
      subscription.account.email.toLowerCase().includes(adminSubscriberQuery) ||
      String(subscription.account.full_name || '').toLowerCase().includes(adminSubscriberQuery)
    const matchesStatus = adminSubscriptionStatus === 'all' ||
      subscription.status === adminSubscriptionStatus
    const matchesPlan = adminSubscriptionPlan === 'all' ||
      subscription.plan_id === adminSubscriptionPlan
    return matchesSearch && matchesStatus && matchesPlan
  })
  const workspaceNumberQuery = workspaceNumberSearch.trim().toLowerCase()
  const workspaceNumberQueryDigits = phoneDigits(workspaceNumberQuery)
  const filteredWorkspaceNumbers = workspaceNumbers.filter((number) => {
    if (!workspaceNumberQuery) return true
    const name = String(number.display_name || '').toLowerCase()
    const numberDigits = phoneDigits(number.phone)
    return name.includes(workspaceNumberQuery) ||
      Boolean(workspaceNumberQueryDigits && numberDigits.includes(workspaceNumberQueryDigits))
  })
  const workspaceNumberTotalPages = Math.max(
    1,
    Math.ceil(filteredWorkspaceNumbers.length / workspaceNumberPageSize)
  )
  const currentWorkspaceNumberPage = Math.min(workspaceNumberPage, workspaceNumberTotalPages)
  const workspaceNumberPageStart = (currentWorkspaceNumberPage - 1) * workspaceNumberPageSize
  const paginatedWorkspaceNumbers = filteredWorkspaceNumbers.slice(
    workspaceNumberPageStart,
    workspaceNumberPageStart + workspaceNumberPageSize
  )

  if (view === 'home') {
    return <LandingPage onLogin={() => { setMessage(''); setView('login'); window.scrollTo(0, 0) }} onTrial={startTrial} />
  }

  if (view !== 'dashboard') {
    const currentPlan = plans.find((plan) => plan.id === selectedPlan)
    return (
      <div className="auth-shell">
        <section className={`auth-card ${view === 'signup' ? 'signup' : ''}`}>
          <button className="auth-brand" type="button" onClick={() => { setMessage(''); setView('home') }}><span className="brand">SNW<span>•</span></span></button>
          <p className="eyebrow">WhatsApp Operations</p>
          <h1>{view === 'login' ? 'Bem-vindo de volta' : view === 'signup' ? 'Crie sua conta' : 'Defina uma nova senha'}</h1>
          <p className="muted">
            {view === 'login' ? 'Acesse o painel de monitoramento.' : view === 'signup' ? 'Crie seu workspace e comece agora. Não é necessária aprovação manual.' : 'Use uma senha segura com pelo menos 8 caracteres.'}
          </p>
          {view === 'signup' && currentPlan && <div className="selected-plan"><span>Plano escolhido</span><strong>{currentPlan.name} • {currentPlan.integrations} {currentPlan.integrations === 1 ? 'integração' : 'integrações'}</strong><b>R$ {currentPlan.price}/mês após o teste</b></div>}
          {view === 'signup' && <input value={signupCompany} onChange={(e) => setSignupCompany(e.target.value)} placeholder="Nome da empresa / workspace" />}
          {view === 'signup' && <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo" />}
          {view !== 'reset-password' && <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={view === 'reset-password' ? 'Nova senha' : 'Senha'} onKeyDown={(e) => e.key === 'Enter' && (view === 'login' ? login() : view === 'signup' ? signup() : resetPassword())} />
          {view === 'login' && <button className="auth-inline-link" type="button" onClick={requestPasswordRecovery}>Esqueci minha senha</button>}
          {view === 'signup' && currentPlan && <div className="signup-providers">
            <span>Escolha {currentPlan.integrations} {currentPlan.integrations === 1 ? 'integração' : 'integrações'}</span>
            <div>{(['uazapi', 'evolution', 'waha'] as const).map((provider) => {
              const checked = signupProviders.includes(provider)
              return <label className={checked ? 'selected' : ''} key={provider}>
                <input type="checkbox" checked={checked} onChange={(event) => {
                  if (!event.target.checked) {
                    setSignupProviders((current) => current.filter((item) => item !== provider))
                    return
                  }
                  if (signupProviders.length >= currentPlan.integrations) {
                    setMessage(`O plano ${currentPlan.name} permite ${currentPlan.integrations} integração(ões)`)
                    return
                  }
                  setMessage('')
                  setSignupProviders((current) => [...current, provider])
                }} />
                <span className={`signup-provider-logo ${provider}`}><img src={providerLogoPath[provider]} alt="" /></span>
                <b>{provider.toUpperCase()}</b>
              </label>
            })}</div>
          </div>}
          <button onClick={view === 'login' ? login : view === 'signup' ? signup : resetPassword}>{view === 'login' ? 'Entrar' : view === 'signup' ? 'Começar 7 dias grátis' : 'Alterar senha'}</button>
          {view !== 'reset-password' && <button className="link-button" onClick={() => { view === 'login' ? startTrial() : setView('login'); setMessage('') }}>
            {view === 'login' ? 'Ainda não tenho uma conta' : 'Voltar para o login'}
          </button>}
          <button className="back-home" type="button" onClick={() => { setMessage(''); setView('home') }}>← Voltar para a página inicial</button>
          {message && <p className="message">{message}</p>}
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><div className="brand">SNW<span>•</span></div><p>Central de operações WhatsApp</p></div>
        <div className="user-area"><div><strong>{user?.full_name || user?.email}</strong><small>{user?.role}</small></div><button className="secondary" onClick={logout}>Sair</button></div>
      </header>

      {user?.role === 'superadmin' && pendingUsers.length > 0 && (
        <section className="panel pending-panel">
          <div><p className="eyebrow">Aprovações</p><h2>{pendingUsers.length} conta(s) aguardando</h2></div>
          <div className="approval-list">
            {pendingUsers.map((pending) => (
              <div className="approval-item" key={pending.id}>
                <span><strong>{pending.full_name}</strong><small>{pending.email}</small></span>
                <button onClick={() => approveUser(pending.id, true)}>Aprovar</button>
                <button className="danger" onClick={() => approveUser(pending.id, false)}>Recusar</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <main className="dashboard-grid">
        <aside className="panel sidebar">
          <p className="eyebrow">Workspaces</p>
          <div className="nav-list">
            {workspaces.map((workspace) => <button className={workspace.id === selectedWorkspace?.id ? 'active' : ''} key={workspace.id} onClick={() => selectWorkspace(workspace)}>{workspace.name}</button>)}
          </div>
          <div className="sidebar-sections">
            <p className="eyebrow">Menu</p>
            <button className={dashboardSection === 'operation' ? 'active' : ''} type="button" onClick={() => setDashboardSection('operation')}><span>⌁</span><div><strong>Operação</strong><small>Monitoramento e integrações</small></div></button>
            <button className={dashboardSection === 'subscription' ? 'active' : ''} type="button" onClick={() => { setDashboardSection('subscription'); if (user?.role === 'superadmin') void loadAdminSubscriptions() }}><span>◇</span><div><strong>Assinatura</strong><small>{user?.role === 'superadmin' ? 'Todos os assinantes' : 'Plano e dados de cobrança'}</small></div></button>
            <button className={dashboardSection === 'payments' ? 'active' : ''} type="button" onClick={() => { setDashboardSection('payments'); if (selectedWorkspace) void loadPayments(selectedWorkspace.id) }}><span>▤</span><div><strong>Pagamentos</strong><small>Histórico financeiro</small></div></button>
            {user?.role === 'superadmin' && <button className={dashboardSection === 'emails' ? 'active' : ''} type="button" onClick={() => { setDashboardSection('emails'); void loadEmailTemplates() }}><span>✉</span><div><strong>E-mails</strong><small>Modelos e disparos</small></div></button>}
            {user?.role === 'superadmin' && <button className={dashboardSection === 'campaigns' ? 'active' : ''} type="button" onClick={() => { setDashboardSection('campaigns'); void loadEmailCampaigns(); void loadEmailAudienceCount() }}><span>◉</span><div><strong>Campanhas</strong><small>Envios em massa</small></div></button>}
          </div>
          {false && user?.role === 'superadmin' && <div className="compact-form"><h3>Novo workspace</h3><input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Nome" /><input value={workspaceSlug} onChange={(e) => setWorkspaceSlug(e.target.value)} placeholder="slug" /><button onClick={createWorkspace}>Criar</button></div>}
        </aside>

        <section className="content">
          {billingInGrace && <div className="billing-warning grace">
            <span>!</span>
            <div><strong>Pagamento pendente — operação mantida temporariamente</strong><p>Regularize até {formatBillingDate(billingSubscription?.billing_access.grace_ends_at || null)}. Depois desse prazo, o painel operacional e os alertas serão suspensos.</p></div>
            <button type="button" onClick={() => setDashboardSection('payments')}>Ver pagamentos</button>
          </div>}
          {dashboardSection === 'operation' && operationBlocked && <section className="panel billing-blocked-panel">
            <span>!</span>
            <p className="eyebrow">Acesso suspenso</p>
            <h2>Regularize a assinatura para reativar a operação</h2>
            <p>O prazo de três dias terminou sem confirmação do pagamento. O monitoramento permanece sem disparar comunicações por WhatsApp ou e-mail até a regularização.</p>
            <div><button type="button" onClick={() => setDashboardSection('payments')}>Ver pagamentos</button><button className="secondary" type="button" onClick={() => setDashboardSection('subscription')}>Ver assinatura</button></div>
          </section>}

          {dashboardSection === 'operation' && !operationBlocked && <div className="metrics">
            <article><small>Integrações liberadas</small><strong>{integrations.length}</strong></article>
            <article><small>Números monitorados</small><strong>{workspaceNumbers.filter((number) => number.monitoring_enabled !== false).length}</strong></article>
            <article><small>Conectados</small><strong className="green">{workspaceNumbers.filter((item) => item.status === 'connected').length}</strong></article>
            <article><small>Desconectados</small><strong className="red">{workspaceNumbers.filter((item) => item.status === 'disconnected').length}</strong></article>
          </div>}

          {dashboardSection === 'subscription' && user?.role === 'superadmin' && <section className="panel admin-subscriptions-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Superadmin</p>
                <div className="heading-with-info"><h2>Assinantes e testes grátis</h2><InfoTip text="Visão administrativa de todos os clientes, planos e situações de cobrança. Sua conta de superadmin é isenta e nunca será bloqueada por assinatura." /></div>
              </div>
              <button className="secondary" type="button" onClick={loadAdminSubscriptions} disabled={adminSubscriptionsLoading}>{adminSubscriptionsLoading ? 'Atualizando...' : 'Atualizar lista'}</button>
            </div>
            <div className="admin-subscription-summary">
              <article><small>Total de assinantes</small><strong>{adminSubscriptionSummary.total}</strong></article>
              <article><small>Em teste grátis</small><strong>{adminSubscriptionSummary.statuses.trialing || 0}</strong></article>
              <article><small>Assinaturas ativas</small><strong className="green">{adminSubscriptionSummary.statuses.active || 0}</strong></article>
              <article><small>Exigem atenção</small><strong className="red">{(adminSubscriptionSummary.statuses.checkout_pending || 0) + (adminSubscriptionSummary.statuses.past_due || 0) + (adminSubscriptionSummary.statuses.expired || 0) + (adminSubscriptionSummary.statuses.canceled || 0)}</strong></article>
            </div>
            <div className="admin-plan-distribution">
              {plans.map((plan) => <span key={plan.id}><b>{plan.name}</b> {adminSubscriptionSummary.plans[plan.id] || 0}</span>)}
              <span className="admin-exemption">Superadmin: acesso irrestrito</span>
            </div>
            <div className="admin-subscription-toolbar">
              <label><span>Buscar assinante</span><input type="search" value={adminSubscriptionSearch} onChange={(event) => setAdminSubscriptionSearch(event.target.value)} placeholder="Empresa, responsável ou e-mail" /></label>
              <label><span>Status</span><select value={adminSubscriptionStatus} onChange={(event) => setAdminSubscriptionStatus(event.target.value)}><option value="all">Todos</option><option value="trialing">Teste grátis</option><option value="active">Ativa</option><option value="checkout_pending">Pagamento iniciado</option><option value="past_due">Pagamento pendente</option><option value="expired">Teste expirado</option><option value="canceled">Cancelada</option></select></label>
              <label><span>Plano</span><select value={adminSubscriptionPlan} onChange={(event) => setAdminSubscriptionPlan(event.target.value as 'all' | PlanId)}><option value="all">Todos</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
            </div>
            {adminSubscriptionsError && <p className="message billing-error">{adminSubscriptionsError}</p>}
            <div className="table-wrap admin-subscription-table"><table>
              <thead><tr><th>Cliente</th><th>Responsável</th><th>Plano</th><th>Status</th><th>Teste / vencimento</th><th>Última cobrança</th><th>Cadastro</th></tr></thead>
              <tbody>{filteredAdminSubscriptions.map((subscription) => <tr key={subscription.id}>
                <td><strong>{subscription.workspace.name}</strong><small>{subscription.workspace.slug}</small></td>
                <td><strong>{subscription.account.full_name || '—'}</strong><small>{subscription.account.email}</small></td>
                <td><strong>{subscription.plan_name}</strong><small>{(subscription.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês</small></td>
                <td><span className={`billing-status ${subscription.status}`}>{subscriptionStatusLabels[subscription.status] || subscription.status}</span></td>
                <td>{formatBillingDate(subscription.status === 'trialing' ? subscription.trial_ends_at : subscription.next_due_date)}</td>
                <td>{subscription.last_payment_status ? (paymentStatusLabels[subscription.last_payment_status.toUpperCase()] || subscription.last_payment_status.replace(/_/g, ' ')) : '—'}</td>
                <td>{formatBillingDate(subscription.created_at)}</td>
              </tr>)}</tbody>
            </table>{!adminSubscriptionsLoading && !filteredAdminSubscriptions.length && !adminSubscriptionsError && <p className="empty">Nenhum assinante encontrado com estes filtros.</p>}</div>
          </section>}

          {dashboardSection === 'subscription' && user?.role !== 'superadmin' && selectedWorkspace && <section className="panel billing-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Assinatura</p>
                <div className="heading-with-info"><h2>Plano e pagamento</h2><InfoTip text="A cobrança é mensal por quantidade de integrações, com instâncias ilimitadas. Você será direcionado ao checkout seguro do Asaas para cadastrar o cartão. O SNW só considera o pagamento confirmado depois de receber o webhook oficial do Asaas." /></div>
              </div>
              {billingSubscription && <span className={`billing-status ${billingSubscription.status}`}>{
                subscriptionStatusLabels[billingSubscription.status]
              }</span>}
            </div>
            {billingSubscription && <div className="billing-summary">
              <div><small>Plano atual</small><strong>{billingSubscription.plan_name}</strong></div>
              <div><small>Valor mensal</small><strong>{(billingSubscription.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
              <div><small>{billingSubscription.status === 'trialing' ? 'Fim do teste' : 'Próximo vencimento'}</small><strong>{(billingSubscription.status === 'trialing' ? billingSubscription.trial_ends_at : billingSubscription.next_due_date) ? new Date(`${(billingSubscription.status === 'trialing' ? billingSubscription.trial_ends_at : billingSubscription.next_due_date)!.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</strong></div>
            </div>}
            {canManage && billingSubscription?.status !== 'active' && billingSubscription?.status !== 'past_due' && <div className="billing-checkout">
              <div className="billing-plan-options">
                {plans.map((plan) => <button type="button" className={billingPlanId === plan.id ? 'billing-plan-option selected' : 'billing-plan-option'} key={plan.id} onClick={() => setBillingPlanId(plan.id)}>
                  <span><strong>{plan.name}</strong><small>{plan.integrations} {plan.integrations === 1 ? 'integração' : 'integrações'}</small></span>
                  <b>R$ {plan.price}<small>/mês</small></b>
                </button>)}
              </div>
              <div className="billing-profile">
                <div><strong>Dados para cobrança</strong><small>Preencha os dados do titular da assinatura. Eles ficarão salvos para os próximos acessos.</small></div>
                <div className="billing-profile-grid">
                  <label className="billing-name"><span>Nome completo ou razão social</span><input autoComplete="name" value={billingProfile.name} onChange={(event) => setBillingProfile((current) => ({ ...current, name: event.target.value }))} placeholder="Nome completo do titular" /></label>
                  <label className="billing-document"><span>CPF ou CNPJ</span><input inputMode="numeric" autoComplete="off" value={billingProfile.cpfCnpj} onChange={(event) => setBillingProfile((current) => ({ ...current, cpfCnpj: formatCpfCnpj(event.target.value) }))} placeholder="000.000.000-00" /></label>
                  <label><span>Telefone com DDD</span><input type="tel" inputMode="numeric" autoComplete="tel" value={billingProfile.phone} onChange={(event) => setBillingProfile((current) => ({ ...current, phone: formatBillingPhone(event.target.value) }))} placeholder="(11) 99999-9999" /></label>
                  <label className="billing-cep"><span>CEP</span><input inputMode="numeric" autoComplete="postal-code" value={billingProfile.postalCode} onBlur={() => { if (!billingProfile.cityCode) void lookupBillingCep() }} onChange={(event) => {
                    const postalCode = formatPostalCode(event.target.value)
                    setBillingProfile((current) => ({ ...current, postalCode, city: '', state: '', cityCode: '' }))
                    setCepError('')
                    if (billingDigits(postalCode).length === 8) void lookupBillingCep(postalCode)
                  }} placeholder="00000-000" />{(cepLoading || cepError) && <small className={cepError ? 'cep-feedback error' : 'cep-feedback'} aria-live="polite">{cepLoading ? 'Consultando CEP...' : cepError}</small>}</label>
                  <label><span>Cidade</span><input autoComplete="address-level2" value={billingProfile.city} readOnly placeholder="Preenchida pelo CEP" /></label>
                  <label><span>Estado</span><input autoComplete="address-level1" value={billingProfile.state} readOnly placeholder="UF" /></label>
                  <label className="billing-address"><span>Logradouro</span><input autoComplete="street-address" value={billingProfile.address} onChange={(event) => setBillingProfile((current) => ({ ...current, address: event.target.value }))} placeholder="Rua, avenida..." /></label>
                  <label><span>Número</span><input autoComplete="off" value={billingProfile.addressNumber} onChange={(event) => setBillingProfile((current) => ({ ...current, addressNumber: event.target.value }))} placeholder="123" /></label>
                  <label><span>Complemento (opcional)</span><input autoComplete="off" value={billingProfile.complement} onChange={(event) => setBillingProfile((current) => ({ ...current, complement: event.target.value }))} placeholder="Sala, bloco..." /></label>
                  <label className="billing-province"><span>Bairro</span><input autoComplete="address-level3" value={billingProfile.province} onChange={(event) => setBillingProfile((current) => ({ ...current, province: event.target.value }))} placeholder="Centro" /></label>
                </div>
              </div>
              <div className="billing-action"><div><strong>Cartão de crédito recorrente</strong><small>Os dados do cartão serão preenchidos no ambiente seguro do Asaas. A primeira cobrança respeita o período grátis restante.</small></div><button type="button" onClick={startAsaasCheckout} disabled={billingLoading}>{billingLoading ? 'Gerando checkout...' : billingSubscription?.status === 'checkout_pending' ? 'Continuar pagamento' : 'Assinar plano'}</button></div>
            </div>}
            {billingSubscription?.status === 'past_due' && <div className="billing-past-due"><strong>Pagamento pendente</strong><p>Use a área Pagamentos para abrir a cobrança e regularizar. O acesso será restabelecido automaticamente após a confirmação do Asaas.</p><button type="button" onClick={() => setDashboardSection('payments')}>Ir para pagamentos</button></div>}
            {billingSubscription?.status === 'active' && <p className="billing-confirmation">✓ Pagamento confirmado pelo Asaas. Seu plano está ativo.</p>}
            {billingError && <p className="message billing-error">{billingError}</p>}
          </section>}

          {dashboardSection === 'payments' && selectedWorkspace && <section className="panel payments-panel">
            <div className="section-title">
              <div>
                <p className="eyebrow">Financeiro</p>
                <div className="heading-with-info"><h2>Histórico de pagamentos</h2><InfoTip text="Exibe as cobranças processadas pelo Asaas, sempre da mais recente para a mais antiga. O status é atualizado pelos webhooks oficiais de pagamento." /></div>
              </div>
              <button className="secondary payments-refresh" type="button" onClick={() => { void loadPayments(selectedWorkspace.id); void loadBilling(selectedWorkspace.id) }} disabled={paymentsLoading}>{paymentsLoading ? 'Atualizando...' : 'Atualizar'}</button>
            </div>
            {paymentsError && <p className="message billing-error">{paymentsError}</p>}
            <div className="table-wrap payment-table"><table>
              <thead><tr><th>Data</th><th>Descrição</th><th>Forma</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Comprovante</th></tr></thead>
              <tbody>{payments.map((payment) => {
                const normalizedStatus = payment.status.toUpperCase()
                return <tr key={payment.id}>
                  <td>{formatBillingDate(payment.payment_date || payment.created_at)}</td>
                  <td><strong>{payment.description}</strong>{payment.asaas_payment_id && <small>{payment.asaas_payment_id}</small>}</td>
                  <td>{billingTypeLabels[payment.billing_type] || payment.billing_type}</td>
                  <td><strong>{payment.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></td>
                  <td>{formatBillingDate(payment.due_date)}</td>
                  <td><span className={`payment-status ${normalizedStatus.toLowerCase()}`}>{paymentStatusLabels[normalizedStatus] || normalizedStatus.replace(/_/g, ' ')}</span></td>
                  <td>{payment.invoice_url ? <a href={payment.invoice_url} target="_blank" rel="noreferrer">Abrir</a> : '—'}</td>
                </tr>
              })}</tbody>
            </table>{!paymentsLoading && !payments.length && !paymentsError && <div className="payments-empty"><span>▤</span><strong>Nenhum pagamento registrado</strong><p>Assim que uma cobrança for criada ou paga no Asaas, ela aparecerá aqui.</p></div>}</div>
          </section>}

          {dashboardSection === 'emails' && user?.role === 'superadmin' && <>
            <section className="panel email-template-panel">
              <div className="section-title">
                <div>
                  <p className="eyebrow">Superadmin</p>
                  <div className="heading-with-info"><h2>Modelos de e-mail</h2><InfoTip text="Estes textos são usados nos e-mails automáticos da plataforma. As variáveis entre chaves, como {{numberName}}, são substituídas pelos dados reais no momento do envio." /></div>
                </div>
                <button className="secondary" type="button" onClick={loadEmailTemplates} disabled={emailTemplateLoading}>{emailTemplateLoading ? 'Atualizando...' : 'Atualizar'}</button>
              </div>
              <div className="email-template-layout">
                <div className="email-template-list" role="tablist" aria-label="Tipos de e-mail">
                  {emailTemplates.map((template) => <button
                    type="button"
                    role="tab"
                    aria-selected={template.key === selectedEmailTemplateKey}
                    className={template.key === selectedEmailTemplateKey ? 'active' : ''}
                    key={template.key}
                    onClick={() => selectEmailTemplate(template)}
                  >
                    <span><strong>{template.display_name}</strong><small>{template.usage_description}</small></span>
                    <b className={template.customized ? 'customized' : ''}>{template.customized ? 'EDITADO' : 'PADRÃO'}</b>
                  </button>)}
                  {!emailTemplates.length && <p className="empty">Nenhum modelo carregado.</p>}
                </div>
                {selectedEmailTemplate && emailTemplateDraft && <div className="email-template-editor">
                  <div className="email-template-context">
                    <div><span className="template-category">{selectedEmailTemplate.category}</span><h3>{selectedEmailTemplate.display_name}</h3></div>
                    <p><strong>Onde é usado:</strong> {selectedEmailTemplate.usage_description}</p>
                    <div className="template-variables"><span>Variáveis disponíveis:</span>{selectedEmailTemplate.available_variables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>)}</div>
                  </div>
                  <div className="email-template-fields">
                    <label className="wide"><span>Assunto da mensagem</span><input value={emailTemplateDraft.subject_template} onChange={(event) => setEmailTemplateDraft((current) => current ? ({ ...current, subject_template: event.target.value }) : current)} /></label>
                    <label><span>Etiqueta superior</span><input value={emailTemplateDraft.eyebrow_template} onChange={(event) => setEmailTemplateDraft((current) => current ? ({ ...current, eyebrow_template: event.target.value }) : current)} /></label>
                    <label><span>Texto de prévia</span><input value={emailTemplateDraft.preheader_template} onChange={(event) => setEmailTemplateDraft((current) => current ? ({ ...current, preheader_template: event.target.value }) : current)} /></label>
                    <label className="wide"><span>Título dentro do e-mail</span><input value={emailTemplateDraft.title_template} onChange={(event) => setEmailTemplateDraft((current) => current ? ({ ...current, title_template: event.target.value }) : current)} /></label>
                    <label className="wide"><span>Texto principal</span><textarea rows={8} value={emailTemplateDraft.content_template} onChange={(event) => setEmailTemplateDraft((current) => current ? ({ ...current, content_template: event.target.value }) : current)} /></label>
                    <label><span>Texto do botão</span><input value={emailTemplateDraft.button_label_template} onChange={(event) => setEmailTemplateDraft((current) => current ? ({ ...current, button_label_template: event.target.value }) : current)} /></label>
                    <label><span>URL do botão</span><input value={emailTemplateDraft.button_url_template} onChange={(event) => setEmailTemplateDraft((current) => current ? ({ ...current, button_url_template: event.target.value }) : current)} placeholder="https://... ou {{dashboardUrl}}" /></label>
                  </div>
                  <div className="email-template-actions">
                    <button className="secondary" type="button" onClick={resetEmailTemplate} disabled={emailTemplateLoading || !selectedEmailTemplate.customized}>Restaurar padrão</button>
                    <button type="button" onClick={saveEmailTemplate} disabled={emailTemplateLoading}>{emailTemplateLoading ? 'Salvando...' : 'Salvar modelo'}</button>
                  </div>
                </div>}
              </div>
            </section>
            <section className="panel email-message-history">
              <div className="section-title"><div><p className="eyebrow">Auditoria</p><h2>Últimos e-mails disparados</h2></div><span className="audience-count">{emailMessages.length} registro(s)</span></div>
              <div className="table-wrap"><table><thead><tr><th>Data</th><th>Tipo de disparo</th><th>Destinatário</th><th>Assunto</th><th>Status</th></tr></thead><tbody>{emailMessages.map((item) => {
                const template = emailTemplates.find((candidate) => candidate.key === item.template_key)
                return <tr key={item.id}><td>{new Date(item.created_at).toLocaleString('pt-BR')}</td><td><strong>{template?.display_name || item.template_key.replace(/_/g, ' ')}</strong><small>{template?.usage_description || item.category}</small></td><td>{item.recipient_name && <strong>{item.recipient_name}</strong>}<small>{item.recipient_email}</small></td><td>{item.subject}{item.error_message && <small className="email-error-detail">{item.error_message}</small>}</td><td><span className={`email-delivery-status ${item.status}`}>{item.status}</span></td></tr>
              })}</tbody></table>{!emailMessages.length && <p className="empty">Nenhum disparo de e-mail registrado.</p>}</div>
            </section>
          </>}

          {dashboardSection === 'campaigns' && user?.role === 'superadmin' && <>
            <section className="panel email-campaign-panel">
              <div className="section-title"><div><p className="eyebrow">Superadmin</p><div className="heading-with-info"><h2>Nova campanha de e-mail</h2><InfoTip text="Envia comunicações em massa somente para clientes elegíveis. Descadastros, reclamações de spam e endereços rejeitados são removidos automaticamente. Alertas operacionais e cobranças não são afetados pelo descadastro comercial." /></div></div><span className="audience-count">{emailAudienceCount === null ? '—' : emailAudienceCount} destinatário(s)</span></div>
              <div className="email-campaign-grid">
                <label><span>Nome interno</span><input value={emailCampaignForm.name} onChange={(event) => setEmailCampaignForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Novidades de agosto" /></label>
                <label><span>Público</span><select value={emailCampaignForm.audience} onChange={(event) => { const audience = event.target.value as CampaignAudience; setEmailCampaignForm((current) => ({ ...current, audience })); void loadEmailAudienceCount(audience) }}><option value="all_clients">Todos os clientes</option><option value="active_subscribers">Assinaturas ativas</option><option value="trialing">Em teste grátis</option><option value="checkout_pending">Checkout pendente</option><option value="past_due">Pagamento em atraso</option></select></label>
                <label className="wide"><span>Assunto</span><input value={emailCampaignForm.subject} onChange={(event) => setEmailCampaignForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Assunto que aparecerá na caixa de entrada" /></label>
                <label className="wide"><span>Prévia curta</span><input value={emailCampaignForm.preheader} onChange={(event) => setEmailCampaignForm((current) => ({ ...current, preheader: event.target.value }))} placeholder="Texto exibido ao lado do assunto (opcional)" /></label>
                <label className="wide"><span>Mensagem</span><textarea rows={7} value={emailCampaignForm.contentText} onChange={(event) => setEmailCampaignForm((current) => ({ ...current, contentText: event.target.value }))} placeholder="Escreva a mensagem. Separe parágrafos com uma linha em branco." /></label>
                <label><span>Texto do botão</span><input value={emailCampaignForm.buttonLabel} onChange={(event) => setEmailCampaignForm((current) => ({ ...current, buttonLabel: event.target.value }))} placeholder="Ex.: Acessar novidade" /></label>
                <label><span>URL HTTPS do botão</span><input type="url" value={emailCampaignForm.buttonUrl} onChange={(event) => setEmailCampaignForm((current) => ({ ...current, buttonUrl: event.target.value }))} placeholder="https://..." /></label>
              </div>
              <div className="email-campaign-actions">
                <input type="email" value={emailCampaignForm.testEmail} onChange={(event) => setEmailCampaignForm((current) => ({ ...current, testEmail: event.target.value }))} placeholder="E-mail para teste" />
                <button className="secondary" type="button" onClick={sendEmailCampaignTest} disabled={emailCampaignLoading}>Enviar teste</button>
                <button type="button" onClick={createEmailCampaignFromPanel} disabled={emailCampaignLoading}>{emailCampaignLoading ? 'Processando...' : 'Criar e enviar campanha'}</button>
              </div>
              <p className="helper">Toda campanha inclui descadastro com um clique. Faça sempre um envio de teste antes do disparo.</p>
            </section>
            <section className="panel email-campaign-history">
              <div className="section-title"><div><p className="eyebrow">Histórico</p><h2>Campanhas enviadas</h2></div><button className="secondary" type="button" onClick={loadEmailCampaigns}>Atualizar</button></div>
              <div className="table-wrap"><table><thead><tr><th>Data</th><th>Campanha</th><th>Público</th><th>Status</th><th>Destinatários</th><th>Enviados</th><th>Falhas</th></tr></thead><tbody>{emailCampaigns.map((campaign) => <tr key={campaign.id}><td>{new Date(campaign.created_at).toLocaleString('pt-BR')}</td><td><strong>{campaign.name}</strong><small>{campaign.subject}</small>{campaign.last_error && <small className="message">{campaign.last_error}</small>}</td><td>{campaign.audience.replace(/_/g, ' ')}</td><td><span className={`campaign-status ${campaign.status}`}>{campaign.status}</span></td><td>{campaign.total_recipients}</td><td>{campaign.sent_count}</td><td>{campaign.failed_count}</td></tr>)}</tbody></table>{!emailCampaigns.length && <p className="empty">Nenhuma campanha criada ainda.</p>}</div>
            </section>
          </>}

          {dashboardSection === 'operation' && !operationBlocked && user?.role === 'superadmin' && <section className="panel">
            <div className="section-title"><div><p className="eyebrow">Superadmin</p><h2>Cadastrar cliente e acesso</h2></div></div>
            <div className="customer-grid">
              <input value={customerCompany} onChange={(e) => { setCustomerCompany(e.target.value); if (!customerSlug) setCustomerSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')) }} placeholder="Empresa / workspace" />
              <input value={customerSlug} onChange={(e) => setCustomerSlug(e.target.value)} placeholder="Slug" />
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nome do responsável" />
              <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="E-mail de acesso" />
              <input type="password" value={customerPassword} onChange={(e) => setCustomerPassword(e.target.value)} placeholder="Senha inicial" />
            </div>
            <div className="provider-checks">{(['uazapi', 'evolution', 'waha'] as const).map((provider) => <label key={provider}><input type="checkbox" checked={customerProviders.includes(provider)} onChange={(e) => setCustomerProviders((current) => e.target.checked ? [...current, provider] : current.filter((item) => item !== provider))} />{provider.toUpperCase()}</label>)}<button onClick={provisionCustomer}>Criar cliente</button></div>
          </section>}

          {dashboardSection === 'operation' && !operationBlocked && selectedWorkspace && <section className="panel monitoring-settings">
            <div className="section-title"><div><p className="eyebrow">Regras do cliente</p><div className="heading-with-info"><h2>Monitoramento e notificações</h2><InfoTip text="Define como este workspace será monitorado. Cadastre o WhatsApp e o e-mail do responsável técnico, escolha se novos números entram automaticamente no monitoramento e se deve haver aviso após a reconexão. O botão Monitoramento geral pausa ou ativa todos os alertas deste cliente." /></div></div><label className="switch-label"><input type="checkbox" checked={selectedWorkspace.monitoring_enabled ?? true} onChange={(e) => saveWorkspaceMonitoring({ monitoring_enabled: e.target.checked })} /><span />Monitoramento geral</label></div>
            <div className="monitor-grid"><label className="field-with-help"><input type="tel" inputMode="numeric" autoComplete="tel" value={workspaceNotifyWhatsapp} onChange={(e) => setWorkspaceNotifyWhatsapp(formatWhatsappPhone(e.target.value))} onBlur={() => setWorkspaceNotifyWhatsapp((current) => addBrazilDdiIfMissing(current))} placeholder="+55 (11) 99999-9999" aria-label="WhatsApp do responsável técnico" /><small>WhatsApp do responsável técnico com DDI e DDD</small></label><label className="field-with-help"><input type="email" value={workspaceNotifyEmail} onChange={(e) => setWorkspaceNotifyEmail(e.target.value)} placeholder="responsavel@empresa.com" aria-label="E-mail do responsável técnico" /><small>E-mail do responsável técnico (opcional)</small></label><label className="check-setting"><input type="checkbox" checked={selectedWorkspace.auto_monitor_new_numbers ?? true} onChange={(e) => saveWorkspaceMonitoring({ auto_monitor_new_numbers: e.target.checked })} /> Monitorar novos números automaticamente</label><label className="check-setting"><input type="checkbox" checked={selectedWorkspace.notify_on_reconnect ?? true} onChange={(e) => saveWorkspaceMonitoring({ notify_on_reconnect: e.target.checked })} /> Avisar quando reconectar</label><button onClick={() => saveWorkspaceMonitoring({})}>Salvar destinos</button></div>
            <div className="workspace-senders"><div className="heading-with-info"><h3>Números que enviarão os alertas</h3><InfoTip text="Escolha uma instância conectada como remetente principal das notificações. O remetente reserva será usado automaticamente se o principal estiver desconectado. Somente números conectados e pertencentes a este workspace aparecem nas listas." /></div><p className="helper">Apenas números conectados deste workspace podem ser selecionados. O reserva assume se o principal desconectar.</p><div className="sender-grid"><select value={primarySenderId} onChange={(e) => setPrimarySenderId(e.target.value)}><option value="">Selecione o remetente principal</option>{notificationSenders.map((sender) => <option key={sender.id} value={sender.id}>{sender.display_name || sender.phone} • {sender.phone} • {sender.provider}</option>)}</select><select value={fallbackSenderId} onChange={(e) => setFallbackSenderId(e.target.value)}><option value="">Selecione o remetente reserva</option>{notificationSenders.filter((sender) => sender.id !== primarySenderId).map((sender) => <option key={sender.id} value={sender.id}>{sender.display_name || sender.phone} • {sender.phone} • {sender.provider}</option>)}</select><button onClick={saveNotificationSenders}>Salvar remetentes</button></div>{!notificationSenders.length && <p className="message">Nenhum número conectado está disponível como remetente.</p>}</div>
          </section>}

          {dashboardSection === 'operation' && !operationBlocked && <section className="panel">
            <div className="section-title"><div><p className="eyebrow">{selectedWorkspace?.name || 'Cliente'}</p><div className="heading-with-info"><h2>Integrações disponíveis</h2><InfoTip text="Conecta o SNW à plataforma de WhatsApp liberada para este cliente. Selecione a integração, informe a URL base da API e o token administrativo ou API key, depois clique em Salvar e sincronizar. Configure também os webhooks indicados para receber status e respostas em tempo real." /></div></div></div>
            <div className="integration-cards">
              {integrations.map((integration) => <article className={selectedIntegration?.id === integration.id ? 'integration-card selected' : 'integration-card'} key={integration.id} onClick={() => { setSelectedIntegration(integration); setIntegrationBaseUrl(integration.base_url || ''); setIntegrationApiKey('') }}>
                <div><span className="integration-card-name"><span className={`integration-mini-logo ${integration.provider}`}><img src={providerLogoPath[integration.provider]} alt="" /></span><b>{integration.provider.toUpperCase()}</b></span><span className={`status ${integration.status === 'active' ? 'connected' : integration.status === 'error' ? 'error' : 'pending'}`}>{integration.status}</span></div>
                <small>{integration.last_sync_at ? `Sincronizado ${new Date(integration.last_sync_at).toLocaleString('pt-BR')}` : 'Aguardando configuração'}</small>
                {integration.last_sync_error && <p className="message">{integration.last_sync_error}</p>}
                <button className="secondary" onClick={(event) => { event.stopPropagation(); void syncSelectedIntegration(integration) }} disabled={!integration.base_url}>Sincronizar agora</button>
              </article>)}
              {!integrations.length && <p className="empty">Nenhuma integração foi liberada para este cliente.</p>}
            </div>
            {selectedIntegration && <div className="integration-box new-config"><h3>Configurar {selectedIntegration.provider.toUpperCase()}</h3><div className="form-grid integration-form"><input value={integrationBaseUrl} onChange={(e) => setIntegrationBaseUrl(e.target.value)} placeholder="URL base da API" /><input type="password" value={integrationApiKey} onChange={(e) => setIntegrationApiKey(e.target.value)} placeholder={selectedIntegration.credentials.apiKeyConfigured ? 'Nova chave (obrigatória para alterar)' : selectedIntegration.provider === 'uazapi' ? 'Admin token' : 'API key'} /><button onClick={configureNewIntegration}>Salvar e sincronizar</button></div><details className="provider-guide"><summary>Como configurar atualizações em tempo real</summary><p>Use uma URL pública HTTPS no formato:</p><code>https://seu-dominio.com/api/webhooks/providers/{selectedIntegration.id}?secret=SEU_WEBHOOK_SECRET</code>{selectedIntegration.provider === 'uazapi' && <p>Na UAZAPI, configure o webhook global com os eventos <b>connection</b> e <b>messages</b>. A credencial usada no SNW deve ser o <b>admintoken</b>, pois ele permite listar todas as instâncias.</p>}{selectedIntegration.provider === 'evolution' && <p>Na Evolution, configure <b>POST /webhook/set/NOME_DA_INSTANCIA</b> para cada instância, com <b>webhookByEvents: false</b> e os eventos <b>CONNECTION_UPDATE</b>, <b>QRCODE_UPDATED</b> e <b>MESSAGES_UPSERT</b>.</p>}{selectedIntegration.provider === 'waha' && <p>No WAHA, configure <b>WHATSAPP_HOOK_EVENTS=session.status,message</b> e envie o header <b>X-Webhook-Secret</b>. Reinicie o container após alterar o ambiente.</p>}</details></div>}
          </section>}

          {dashboardSection === 'operation' && !operationBlocked && <section className="panel">
            <div className="section-title"><div><p className="eyebrow">Monitoramento automático</p><div className="heading-with-info"><h2>Números encontrados nas plataformas</h2><InfoTip text="Lista todas as instâncias importadas das integrações configuradas. Aqui você acompanha número, provedor, identificador da instância, conexão e última atividade. Use Ativo ou Pausado para decidir individualmente quais números devem gerar alertas." /></div></div></div>
            <div className="number-list-toolbar">
              <label className="number-search">
                <span>Buscar</span>
                <input
                  type="search"
                  value={workspaceNumberSearch}
                  onChange={(event) => {
                    setWorkspaceNumberSearch(event.target.value)
                    setWorkspaceNumberPage(1)
                  }}
                  placeholder="Nome ou telefone"
                  aria-label="Buscar número por nome ou telefone"
                />
              </label>
              <label className="number-page-size">
                <span>Resultados por página</span>
                <select
                  value={workspaceNumberPageSize}
                  onChange={(event) => {
                    setWorkspaceNumberPageSize(Number(event.target.value) as 25 | 50 | 100)
                    setWorkspaceNumberPage(1)
                  }}
                  aria-label="Resultados por página"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
            <div className="table-wrap number-table-wrap">
              <table>
                <thead><tr><th>Nome</th><th>Número</th><th>Provedor</th><th>Instância</th><th>Status</th><th>Monitorar</th><th>Última atividade</th><th className="number-actions-heading"><span className="sr-only">Ações</span></th></tr></thead>
                <tbody>{paginatedWorkspaceNumbers.map((number) => <tr key={number.id}>
                  <td><div className="instance-name"><span>{number.display_name || '—'}</span>{number.id === savedPrimarySenderId && <span className="sender-tag primary">Principal</span>}{number.id === savedFallbackSenderId && <span className="sender-tag fallback">Reserva</span>}</div></td>
                  <td>{number.phone.startsWith('pending:') ? 'Aguardando conexão' : number.phone}</td>
                  <td>{number.provider}</td>
                  <td>{number.external_id}</td>
                  <td><span className={`status ${number.status}`}>{number.status}</span></td>
                  <td><button className={`monitor-toggle ${number.monitoring_enabled !== false ? 'on' : 'off'}`} onClick={() => toggleNumberMonitoring(number)}>{number.monitoring_enabled !== false ? 'Ativo' : 'Pausado'}</button></td>
                  <td>{number.last_checked_at ? new Date(number.last_checked_at).toLocaleString('pt-BR') : '—'}</td>
                  <td className="number-actions-cell">
                    {['disconnected', 'error'].includes(number.status) && <div className="number-actions" data-number-actions>
                      <button
                        type="button"
                        className="number-actions-trigger"
                        aria-label={`Ações de reconexão para ${number.display_name || number.phone}`}
                        aria-haspopup="menu"
                        aria-expanded={openNumberActionsId === number.id}
                        disabled={manualReconnectLoading?.startsWith(`${number.id}:`)}
                        onClick={() => setOpenNumberActionsId((current) => current === number.id ? null : number.id)}
                      >
                        <span />
                        <span />
                        <span />
                      </button>
                      {openNumberActionsId === number.id && <div className="number-actions-menu" role="menu">
                        <strong>Reconectar manualmente</strong>
                        <small>O acesso será enviado ao número do cliente.</small>
                        <button type="button" role="menuitem" onClick={() => sendManualReconnect(number, 'qr')}>
                          <span className="reconnect-action-icon">▦</span>
                          <span><b>Gerar QR Code</b><small>Enviar imagem para leitura</small></span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => sendManualReconnect(number, 'pairing')}>
                          <span className="reconnect-action-icon">#</span>
                          <span><b>Código de pareamento</b><small>Enviar código numérico</small></span>
                        </button>
                      </div>}
                      {manualReconnectLoading?.startsWith(`${number.id}:`) && <span className="number-action-loading" aria-label="Gerando reconexão">…</span>}
                    </div>}
                  </td>
                </tr>)}</tbody>
              </table>
              {!workspaceNumbers.length && <p className="empty">Configure uma integração para importar os números automaticamente.</p>}
              {Boolean(workspaceNumbers.length && !filteredWorkspaceNumbers.length) && <p className="empty">Nenhum número encontrado para “{workspaceNumberSearch}”.</p>}
            </div>
            {Boolean(filteredWorkspaceNumbers.length) && <div className="number-pagination">
              <span>
                Exibindo {workspaceNumberPageStart + 1}–{Math.min(workspaceNumberPageStart + workspaceNumberPageSize, filteredWorkspaceNumbers.length)} de {filteredWorkspaceNumbers.length}
              </span>
              <div>
                <button type="button" className="secondary" disabled={currentWorkspaceNumberPage === 1} onClick={() => setWorkspaceNumberPage(currentWorkspaceNumberPage - 1)}>Anterior</button>
                <strong>Página {currentWorkspaceNumberPage} de {workspaceNumberTotalPages}</strong>
                <button type="button" className="secondary" disabled={currentWorkspaceNumberPage === workspaceNumberTotalPages} onClick={() => setWorkspaceNumberPage(currentWorkspaceNumberPage + 1)}>Próxima</button>
              </div>
            </div>}
          </section>}

          {false && <section className="panel">
            <div className="section-title"><div><p className="eyebrow">{selectedWorkspace?.name || 'Workspace'}</p><h2>Clientes e integrações</h2></div></div>
            {canManage && selectedWorkspace && <div className="form-grid"><input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nome do cliente" /><select value={clientPlatform} onChange={(e) => setClientPlatform(e.target.value as Client['integration_platform'])}><option value="uazapi">UAZAPI</option><option value="evolution">Evolution</option><option value="waha">WAHA</option></select><input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="E-mail para alertas" /><input value={clientWhatsapp} onChange={(e) => setClientWhatsapp(e.target.value)} placeholder="WhatsApp para alertas" /><button onClick={createClient}>Adicionar cliente</button></div>}
            <div className="client-list">
              {clients.map((client) => <button className={client.id === selectedClient?.id ? 'client-card active' : 'client-card'} key={client.id} onClick={() => { setIntegrationBaseUrl(client.integration_config?.baseUrl || ''); setIntegrationIdentifier(client.integration_config?.instanceName || client.integration_config?.sessionName || ''); setIntegrationApiKey(''); void selectClient(client) }}><span><strong>{client.name}</strong><small>{client.notify_whatsapp || client.notify_email || 'Sem destino padrão'}</small></span><b>{client.integration_platform}</b></button>)}
              {!clients.length && <p className="empty">Nenhum cliente cadastrado neste workspace.</p>}
            </div>
          </section>}

          {dashboardSection === 'operation' && !operationBlocked && selectedClient && <section className="panel">
            <div className="section-title"><div><p className="eyebrow">{selectedClient.name}</p><h2>Números monitorados</h2></div><span className="provider">{selectedClient.integration_platform}</span></div>
            {canManage && <div className="integration-box"><h3>Conexão com {selectedClient.integration_platform.toUpperCase()}</h3><div className="form-grid integration-form"><input value={integrationBaseUrl} onChange={(e) => setIntegrationBaseUrl(e.target.value)} placeholder="URL base da API" /><input type="password" value={integrationApiKey} onChange={(e) => setIntegrationApiKey(e.target.value)} placeholder={selectedClient.integration_config?.apiKeyConfigured ? 'Chave protegida — deixe vazio para manter' : 'Token / API key'} />{selectedClient.integration_platform !== 'uazapi' && <input value={integrationIdentifier} onChange={(e) => setIntegrationIdentifier(e.target.value)} placeholder={selectedClient.integration_platform === 'waha' ? 'Nome da sessão' : 'Nome da instância'} />}<button onClick={saveIntegration}>Salvar integração</button></div></div>}
            {canManage && <div className="form-grid number-form"><input value={numberPhone} onChange={(e) => setNumberPhone(e.target.value)} placeholder="Número com DDI (ex.: 5511999999999)" /><select value={numberNotifyChannel} onChange={(e) => setNumberNotifyChannel(e.target.value as 'email' | 'whatsapp')}><option value="whatsapp">Avisar por WhatsApp</option><option value="email">Avisar por e-mail</option></select><input value={numberNotifyTo} onChange={(e) => setNumberNotifyTo(e.target.value)} placeholder="Destino do alerta (opcional)" /><button onClick={createNumber}>Monitorar número</button></div>}
            <div className="table-wrap"><table><thead><tr><th>Número</th><th>Provedor</th><th>Status</th><th>Destino do alerta</th><th>Última atividade</th></tr></thead><tbody>{numbers.map((number) => <tr className={selectedNumber?.id === number.id ? 'selected-row' : ''} key={number.id} onClick={() => selectNumber(number)}><td>{number.phone}</td><td>{number.provider}</td><td><span className={`status ${number.status}`}>{number.status}</span></td><td>{number.notify_to || `Padrão do cliente (${number.notify_channel})`}</td><td>{number.last_seen_at ? new Date(number.last_seen_at).toLocaleString('pt-BR') : '—'}</td></tr>)}</tbody></table>{!numbers.length && <p className="empty">Nenhum número monitorado para este cliente.</p>}</div>
            {selectedNumber && <div className="number-insights"><div className="uptime-card"><p className="eyebrow">Disponibilidade • 30 dias</p><strong>{uptime ? `${uptime.percentage}%` : '...'}</strong><small>{uptime?.incidents ?? 0} incidente(s) registrado(s)</small></div><div className="event-timeline"><p className="eyebrow">Eventos recentes</p>{numberEvents.slice(0, 8).map((event) => <div key={event.id}><span className="timeline-dot" /><strong>{event.event_type.replace(/_/g, ' ')}</strong><time>{new Date(event.created_at).toLocaleString('pt-BR')}</time></div>)}{!numberEvents.length && <p className="empty">Nenhum evento registrado.</p>}</div></div>}
          </section>}
          {processingOverlay && <div className="processing-overlay" role="dialog" aria-modal="true" aria-labelledby="processing-title" aria-describedby="processing-detail">
            <div className="processing-dialog">
              <div className="processing-spinner" aria-hidden="true"><span /></div>
              <p className="eyebrow">Processando solicitação</p>
              <h2 id="processing-title">{processingOverlay.title}</h2>
              <p id="processing-detail">{processingOverlay.detail}</p>
              <div className="processing-progress" aria-hidden="true"><span /></div>
              <small>Não feche esta página. Isso pode levar alguns segundos.</small>
            </div>
          </div>}
          {message && <div className={`message toast ${/(sucesso|concluída|conectada|criados|sincronizados)/i.test(message) ? 'success' : 'error'}`} role="status"><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="Fechar aviso">×</button></div>}
        </section>
      </main>
    </div>
  )
}

export default App
