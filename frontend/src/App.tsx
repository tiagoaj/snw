import { useEffect, useState } from 'react'

type View = 'home' | 'login' | 'signup' | 'reset-password' | 'dashboard'
type PlanId = 'start' | 'growth' | 'scale'
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
  provider: string
  status: 'connected' | 'disconnected' | 'pending' | 'error'
  notify_to: string | null
  notify_channel: 'email' | 'whatsapp'
  last_seen_at: string | null
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
const providerLogoPath = {
  uazapi: '/integrations/uazapi.png',
  evolution: '/integrations/evolution.png',
  waha: '/integrations/waha.png'
}

function LandingPage({ onLogin, onTrial }: { onLogin: () => void; onTrial: (plan?: PlanId) => void }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
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
          <button className="landing-login" type="button" onClick={onLogin}>Entrar</button>
          <button className="landing-cta compact" type="button" onClick={() => onTrial()}>Testar grátis</button>
        </div>
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

const api = async (path: string, token = '', init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Verifique se o backend está rodando na porta 4000.')
  }
  const responseText = await response.text()
  let data: any = {}
  if (responseText) {
    try {
      data = JSON.parse(responseText)
    } catch {
      throw new Error(`O servidor retornou uma resposta inválida (HTTP ${response.status}).`)
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
  const [pendingUsers, setPendingUsers] = useState<UserRow[]>([])
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
    const saved = localStorage.getItem('snw_token')
    if (saved) {
      setToken(saved)
      setView('dashboard')
    }
  }, [])

  useEffect(() => {
    if (!token) return
    localStorage.setItem('snw_token', token)
    void loadSession()
  }, [token])

  useEffect(() => {
    if (view !== 'dashboard' || !message) return
    const timeout = window.setTimeout(() => setMessage(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [message, view])

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
        await loadPendingUsers()
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
      setToken(data.session.access_token)
      setView('dashboard')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  async function signup() {
    setMessage('')
    if (!fullName || !email || password.length < 6) {
      return setMessage('Preencha nome, e-mail e uma senha com pelo menos 6 caracteres')
    }
    try {
      const data = await api('/api/auth/signup', '', {
        method: 'POST',
        body: JSON.stringify({ full_name: fullName, email, password, selected_plan: selectedPlan })
      })
      setPassword('')
      setView('login')
      setMessage(data.status === 'active'
        ? 'Conta de superadmin criada. Você já pode entrar.'
        : 'Cadastro enviado. Após a aprovação do superadmin, seus 7 dias grátis serão iniciados.')
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

  async function loadPendingUsers() {
    const data = await api('/api/users/pending', token)
    setPendingUsers(data.users)
  }

  async function loadNotificationSettings(workspaceId: string) {
    const data = await api(`/api/workspaces/${workspaceId}/notification-settings`, token)
    setNotificationSenders(data.senders)
    setPrimarySenderId(data.settings?.primary_sender_id || '')
    setFallbackSenderId(data.settings?.fallback_sender_id || '')
    setSavedPrimarySenderId(data.settings?.primary_sender_id || '')
    setSavedFallbackSenderId(data.settings?.fallback_sender_id || '')
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
    }
  }

  async function syncSelectedIntegration(integration: Integration) {
    try {
      await api(`/api/integrations/${integration.id}/sync`, token, { method: 'POST' })
      if (selectedWorkspace) await selectWorkspace(selectedWorkspace)
      setMessage('Sincronização concluída')
    } catch (error) {
      setMessage((error as Error).message)
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
    setView('login')
  }

  function startTrial(plan: PlanId = 'growth') {
    setSelectedPlan(plan)
    localStorage.setItem('snw_selected_plan', plan)
    setMessage('')
    setView('signup')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const canManage = user?.role === 'superadmin' || (!!selectedWorkspace && profiles.some(
    (profile) => profile.workspace_id === selectedWorkspace.id && profile.role === 'workspace_admin'
  ))

  if (view === 'home') {
    return <LandingPage onLogin={() => { setMessage(''); setView('login'); window.scrollTo(0, 0) }} onTrial={startTrial} />
  }

  if (view !== 'dashboard') {
    const currentPlan = plans.find((plan) => plan.id === selectedPlan)
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <button className="auth-brand" type="button" onClick={() => { setMessage(''); setView('home') }}><span className="brand">SNW<span>•</span></span></button>
          <p className="eyebrow">WhatsApp Operations</p>
          <h1>{view === 'login' ? 'Bem-vindo de volta' : view === 'signup' ? 'Crie sua conta' : 'Defina uma nova senha'}</h1>
          <p className="muted">
            {view === 'login' ? 'Acesse o painel de monitoramento.' : view === 'signup' ? 'Comece seu período gratuito. Novas contas precisam da aprovação do superadmin.' : 'Use uma senha segura com pelo menos 8 caracteres.'}
          </p>
          {view === 'signup' && currentPlan && <div className="selected-plan"><span>Plano escolhido</span><strong>{currentPlan.name} • {currentPlan.integrations} {currentPlan.integrations === 1 ? 'integração' : 'integrações'}</strong><b>R$ {currentPlan.price}/mês após o teste</b></div>}
          {view === 'signup' && <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo" />}
          {view !== 'reset-password' && <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={view === 'reset-password' ? 'Nova senha' : 'Senha'} onKeyDown={(e) => e.key === 'Enter' && (view === 'login' ? login() : view === 'signup' ? signup() : resetPassword())} />
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
          {false && user?.role === 'superadmin' && <div className="compact-form"><h3>Novo workspace</h3><input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Nome" /><input value={workspaceSlug} onChange={(e) => setWorkspaceSlug(e.target.value)} placeholder="slug" /><button onClick={createWorkspace}>Criar</button></div>}
        </aside>

        <section className="content">
          <div className="metrics">
            <article><small>Integrações liberadas</small><strong>{integrations.length}</strong></article>
            <article><small>Números monitorados</small><strong>{workspaceNumbers.length}</strong></article>
            <article><small>Conectados</small><strong className="green">{workspaceNumbers.filter((item) => item.status === 'connected').length}</strong></article>
            <article><small>Desconectados</small><strong className="red">{workspaceNumbers.filter((item) => item.status === 'disconnected').length}</strong></article>
          </div>

          {user?.role === 'superadmin' && <section className="panel">
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

          {selectedWorkspace && <section className="panel monitoring-settings">
            <div className="section-title"><div><p className="eyebrow">Regras do cliente</p><div className="heading-with-info"><h2>Monitoramento e notificações</h2><InfoTip text="Define como este workspace será monitorado. Cadastre o WhatsApp e o e-mail do responsável técnico, escolha se novos números entram automaticamente no monitoramento e se deve haver aviso após a reconexão. O botão Monitoramento geral pausa ou ativa todos os alertas deste cliente." /></div></div><label className="switch-label"><input type="checkbox" checked={selectedWorkspace.monitoring_enabled ?? true} onChange={(e) => saveWorkspaceMonitoring({ monitoring_enabled: e.target.checked })} /><span />Monitoramento geral</label></div>
            <div className="monitor-grid"><label className="field-with-help"><input type="tel" inputMode="numeric" autoComplete="tel" value={workspaceNotifyWhatsapp} onChange={(e) => setWorkspaceNotifyWhatsapp(formatWhatsappPhone(e.target.value))} onBlur={() => setWorkspaceNotifyWhatsapp((current) => addBrazilDdiIfMissing(current))} placeholder="+55 (11) 99999-9999" aria-label="WhatsApp do responsável técnico" /><small>WhatsApp do responsável técnico com DDI e DDD</small></label><label className="field-with-help"><input type="email" value={workspaceNotifyEmail} onChange={(e) => setWorkspaceNotifyEmail(e.target.value)} placeholder="responsavel@empresa.com" aria-label="E-mail do responsável técnico" /><small>E-mail do responsável técnico (opcional)</small></label><label className="check-setting"><input type="checkbox" checked={selectedWorkspace.auto_monitor_new_numbers ?? true} onChange={(e) => saveWorkspaceMonitoring({ auto_monitor_new_numbers: e.target.checked })} /> Monitorar novos números automaticamente</label><label className="check-setting"><input type="checkbox" checked={selectedWorkspace.notify_on_reconnect ?? true} onChange={(e) => saveWorkspaceMonitoring({ notify_on_reconnect: e.target.checked })} /> Avisar quando reconectar</label><button onClick={() => saveWorkspaceMonitoring({})}>Salvar destinos</button></div>
            <div className="workspace-senders"><div className="heading-with-info"><h3>Números que enviarão os alertas</h3><InfoTip text="Escolha uma instância conectada como remetente principal das notificações. O remetente reserva será usado automaticamente se o principal estiver desconectado. Somente números conectados e pertencentes a este workspace aparecem nas listas." /></div><p className="helper">Apenas números conectados deste workspace podem ser selecionados. O reserva assume se o principal desconectar.</p><div className="sender-grid"><select value={primarySenderId} onChange={(e) => setPrimarySenderId(e.target.value)}><option value="">Selecione o remetente principal</option>{notificationSenders.map((sender) => <option key={sender.id} value={sender.id}>{sender.display_name || sender.phone} • {sender.phone} • {sender.provider}</option>)}</select><select value={fallbackSenderId} onChange={(e) => setFallbackSenderId(e.target.value)}><option value="">Selecione o remetente reserva</option>{notificationSenders.filter((sender) => sender.id !== primarySenderId).map((sender) => <option key={sender.id} value={sender.id}>{sender.display_name || sender.phone} • {sender.phone} • {sender.provider}</option>)}</select><button onClick={saveNotificationSenders}>Salvar remetentes</button></div>{!notificationSenders.length && <p className="message">Nenhum número conectado está disponível como remetente.</p>}</div>
          </section>}

          <section className="panel">
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
          </section>

          <section className="panel">
            <div className="section-title"><div><p className="eyebrow">Monitoramento automático</p><div className="heading-with-info"><h2>Números encontrados nas plataformas</h2><InfoTip text="Lista todas as instâncias importadas das integrações configuradas. Aqui você acompanha número, provedor, identificador da instância, conexão e última atividade. Use Ativo ou Pausado para decidir individualmente quais números devem gerar alertas." /></div></div></div>
            <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Número</th><th>Provedor</th><th>Instância</th><th>Status</th><th>Monitorar</th><th>Última atividade</th></tr></thead><tbody>{workspaceNumbers.map((number: any) => <tr key={number.id}><td><div className="instance-name"><span>{number.display_name || '—'}</span>{number.id === savedPrimarySenderId && <span className="sender-tag primary">Principal</span>}{number.id === savedFallbackSenderId && <span className="sender-tag fallback">Reserva</span>}</div></td><td>{number.phone.startsWith('pending:') ? 'Aguardando conexão' : number.phone}</td><td>{number.provider}</td><td>{number.external_id}</td><td><span className={`status ${number.status}`}>{number.status}</span></td><td><button className={`monitor-toggle ${number.monitoring_enabled !== false ? 'on' : 'off'}`} onClick={() => toggleNumberMonitoring(number)}>{number.monitoring_enabled !== false ? 'Ativo' : 'Pausado'}</button></td><td>{number.last_checked_at ? new Date(number.last_checked_at).toLocaleString('pt-BR') : '—'}</td></tr>)}</tbody></table>{!workspaceNumbers.length && <p className="empty">Configure uma integração para importar os números automaticamente.</p>}</div>
          </section>

          {false && <section className="panel">
            <div className="section-title"><div><p className="eyebrow">{selectedWorkspace?.name || 'Workspace'}</p><h2>Clientes e integrações</h2></div></div>
            {canManage && selectedWorkspace && <div className="form-grid"><input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nome do cliente" /><select value={clientPlatform} onChange={(e) => setClientPlatform(e.target.value as Client['integration_platform'])}><option value="uazapi">UAZAPI</option><option value="evolution">Evolution</option><option value="waha">WAHA</option></select><input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="E-mail para alertas" /><input value={clientWhatsapp} onChange={(e) => setClientWhatsapp(e.target.value)} placeholder="WhatsApp para alertas" /><button onClick={createClient}>Adicionar cliente</button></div>}
            <div className="client-list">
              {clients.map((client) => <button className={client.id === selectedClient?.id ? 'client-card active' : 'client-card'} key={client.id} onClick={() => { setIntegrationBaseUrl(client.integration_config?.baseUrl || ''); setIntegrationIdentifier(client.integration_config?.instanceName || client.integration_config?.sessionName || ''); setIntegrationApiKey(''); void selectClient(client) }}><span><strong>{client.name}</strong><small>{client.notify_whatsapp || client.notify_email || 'Sem destino padrão'}</small></span><b>{client.integration_platform}</b></button>)}
              {!clients.length && <p className="empty">Nenhum cliente cadastrado neste workspace.</p>}
            </div>
          </section>}

          {selectedClient && <section className="panel">
            <div className="section-title"><div><p className="eyebrow">{selectedClient.name}</p><h2>Números monitorados</h2></div><span className="provider">{selectedClient.integration_platform}</span></div>
            {canManage && <div className="integration-box"><h3>Conexão com {selectedClient.integration_platform.toUpperCase()}</h3><div className="form-grid integration-form"><input value={integrationBaseUrl} onChange={(e) => setIntegrationBaseUrl(e.target.value)} placeholder="URL base da API" /><input type="password" value={integrationApiKey} onChange={(e) => setIntegrationApiKey(e.target.value)} placeholder={selectedClient.integration_config?.apiKeyConfigured ? 'Chave protegida — deixe vazio para manter' : 'Token / API key'} />{selectedClient.integration_platform !== 'uazapi' && <input value={integrationIdentifier} onChange={(e) => setIntegrationIdentifier(e.target.value)} placeholder={selectedClient.integration_platform === 'waha' ? 'Nome da sessão' : 'Nome da instância'} />}<button onClick={saveIntegration}>Salvar integração</button></div></div>}
            {canManage && <div className="form-grid number-form"><input value={numberPhone} onChange={(e) => setNumberPhone(e.target.value)} placeholder="Número com DDI (ex.: 5511999999999)" /><select value={numberNotifyChannel} onChange={(e) => setNumberNotifyChannel(e.target.value as 'email' | 'whatsapp')}><option value="whatsapp">Avisar por WhatsApp</option><option value="email">Avisar por e-mail</option></select><input value={numberNotifyTo} onChange={(e) => setNumberNotifyTo(e.target.value)} placeholder="Destino do alerta (opcional)" /><button onClick={createNumber}>Monitorar número</button></div>}
            <div className="table-wrap"><table><thead><tr><th>Número</th><th>Provedor</th><th>Status</th><th>Destino do alerta</th><th>Última atividade</th></tr></thead><tbody>{numbers.map((number) => <tr className={selectedNumber?.id === number.id ? 'selected-row' : ''} key={number.id} onClick={() => selectNumber(number)}><td>{number.phone}</td><td>{number.provider}</td><td><span className={`status ${number.status}`}>{number.status}</span></td><td>{number.notify_to || `Padrão do cliente (${number.notify_channel})`}</td><td>{number.last_seen_at ? new Date(number.last_seen_at).toLocaleString('pt-BR') : '—'}</td></tr>)}</tbody></table>{!numbers.length && <p className="empty">Nenhum número monitorado para este cliente.</p>}</div>
            {selectedNumber && <div className="number-insights"><div className="uptime-card"><p className="eyebrow">Disponibilidade • 30 dias</p><strong>{uptime ? `${uptime.percentage}%` : '...'}</strong><small>{uptime?.incidents ?? 0} incidente(s) registrado(s)</small></div><div className="event-timeline"><p className="eyebrow">Eventos recentes</p>{numberEvents.slice(0, 8).map((event) => <div key={event.id}><span className="timeline-dot" /><strong>{event.event_type.replace(/_/g, ' ')}</strong><time>{new Date(event.created_at).toLocaleString('pt-BR')}</time></div>)}{!numberEvents.length && <p className="empty">Nenhum evento registrado.</p>}</div></div>}
          </section>}
          {message && <div className={`message toast ${/(sucesso|concluída|conectada|criados|sincronizados)/i.test(message) ? 'success' : 'error'}`} role="status"><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="Fechar aviso">×</button></div>}
        </section>
      </main>
    </div>
  )
}

export default App
