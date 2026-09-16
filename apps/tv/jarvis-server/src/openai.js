const KEY = process.env.OPENAI_API_KEY;

// Both are overridable because OpenAI renames and retires models faster than this
// repo will be touched. If a call starts 404-ing, the model name is the first suspect.
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1';

if (!KEY) throw new Error('OPENAI_API_KEY is not set');

async function call(path, { body, headers = {} }) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, ...headers },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI ${path} ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

/** @param audio {Buffer} whatever the phone's MediaRecorder produced. */
export async function transcribe(audio, filename = 'clip.webm', language = 'it') {
  const form = new FormData();
  form.append('file', new Blob([audio]), filename);
  form.append('model', STT_MODEL);
  form.append('language', language);
  const out = await call('audio/transcriptions', { body: form });
  return out.text?.trim() ?? '';
}

export async function chat(messages, tools) {
  const out = await call('chat/completions', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      // The answer is spoken aloud by the TV, so length is a user-experience limit,
      // not a cost one. Two sentences is about as much as anyone wants read back.
      max_tokens: 250,
      temperature: 0.3,
    }),
  });
  return out.choices?.[0]?.message ?? { content: '' };
}

export function systemPrompt(context) {
  return [
    "Sei JARVIS, l'assistente di casa di Davide. Rispondi sempre in italiano.",
    'Le tue risposte vengono lette ad alta voce da una TV, quindi:',
    '- massimo due frasi brevi, niente elenchi puntati, niente markdown, niente emoji;',
    '- numeri scritti in modo pronunciabile;',
    '- se non sai una cosa, dillo in cinque parole invece di inventarla.',
    '',
    'Hai degli strumenti per comandare davvero la TV. Usali invece di descrivere',
    'cosa farebbe l\'utente: se ti chiede di mettere un film, chiamalo davvero con',
    'play_media, poi conferma in una frase che è partito. Non dire mai "puoi',
    'iniziare a guardare" come se dovesse fare lui qualcosa.',
    '',
    'Stato attuale del homelab (dati reali, appena letti):',
    context,
  ].join('\n');
}

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'play_media',
      description:
        'Cerca un film o una serie nella libreria Jellyfin e lo fa partire subito ' +
        'sulla TV del salotto. Usa questo quando Davide chiede di mettere, far ' +
        'partire, guardare o aprire qualcosa.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Il titolo cercato, come lo ha detto Davide. Es. "harry potter".',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_media',
      description:
        'Cerca nella libreria Jellyfin senza far partire niente. Usa questo quando ' +
        'Davide chiede cosa c\'è, se un titolo è disponibile, o quali film ci sono.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tv_key',
      description:
        'Preme un tasto sul telecomando della TV. Usa questo per il volume ' +
        '(volume_up, volume_down, mute), per navigare (up, down, left, right, ok, ' +
        'back, home) o per aprire il menu (options). Il volume agisce sulla ' +
        'soundbar Bose. Per alzare di parecchio, chiamalo più volte.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: ['volume_up', 'volume_down', 'mute', 'up', 'down', 'left', 'right',
                   'ok', 'back', 'home', 'options'],
          },
          repeat: { type: 'integer', description: 'Quante volte premerlo (1-10). Default 1.' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'control_playback',
      description:
        'Comanda la riproduzione già in corso sulla TV: pausa, riprendi, ferma, ' +
        'prossimo, precedente.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['pause', 'resume', 'stop', 'next', 'previous'] },
        },
        required: ['action'],
      },
    },
  },
];
