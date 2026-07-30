type CepAddress = {
  postalCode: string
  address: string
  complement: string
  province: string
  city: string
  state: string
  cityCode: string
}

const cache = new Map<string, CepAddress>()

export async function lookupBrazilianCep(value: unknown): Promise<CepAddress> {
  const postalCode = String(value || '').replace(/\D/g, '')
  if (postalCode.length !== 8) throw new Error('Informe um CEP válido com 8 dígitos')
  const cached = cache.get(postalCode)
  if (cached) return cached

  const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) throw new Error('Não foi possível consultar o CEP informado')
  const data: any = await response.json()
  if (data.erro) throw new Error('CEP não encontrado')

  const address = {
    postalCode,
    address: String(data.logradouro || '').trim(),
    complement: String(data.complemento || '').trim(),
    province: String(data.bairro || '').trim(),
    city: String(data.localidade || '').trim(),
    state: String(data.uf || '').trim().toUpperCase(),
    cityCode: String(data.ibge || '').replace(/\D/g, '')
  }
  if (!address.city || address.state.length !== 2 || !address.cityCode) {
    throw new Error('O CEP não retornou cidade e estado válidos')
  }
  cache.set(postalCode, address)
  return address
}
