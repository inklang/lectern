const NVIDIA_EMBEDDING_URL = 'https://integrate.api.nvidia.com/v1/embeddings'
const MODEL = 'nvidia/nv-embedqa-e5-v5'

export async function embedText(
  text: string,
  inputType: 'passage' | 'query'
): Promise<number[] | null> {
  const apiKey = process.env['NVIDIA_API_KEY']
  if (!apiKey) return null

  try {
    const res = await fetch(NVIDIA_EMBEDDING_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, input: text, input_type: inputType }),
    })

    if (!res.ok) return null
    const json = await res.json() as { data: [{ embedding: number[] }] }
    return json.data[0].embedding
  } catch {
    return null
  }
}
