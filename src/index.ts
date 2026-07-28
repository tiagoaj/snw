import { supabase, supabaseAdmin } from './lib/supabaseClient.js'

async function main() {
  console.log('SNW Whatsapp Notification inicializando...')

  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .limit(1)

  if (error) {
    console.error('Erro ao consultar workspaces:', error.message)
    process.exit(1)
  }

  console.log('Workspaces encontrados:', data?.length ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
