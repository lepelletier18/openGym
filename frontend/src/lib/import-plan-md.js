// Read a training plan written as Markdown and hand back the same bundle a plan file carries
// ({ opengym_plan: 1, routines, week, customEx }), so parsePlan / mergePlan / the import sheet
// treat it exactly like a shared plan: validated, merged as NEW routines, nothing overwritten.
//
// What it looks for (docs/DATA_IMPORTS.md has the friendly version):
//   # Title                         -> the plan's name
//   ## Day A  (or ### or **Day A**)  -> the next exercise table or list becomes this routine
//   | Exercise | Sets x reps |      -> one exercise per row; "3 x 8-12", "3 x 30 sec", "2 x 10 per leg"
//   - Goblet squat: 3 x 12          -> the same, as a bullet list
//   | Day | Session |               -> the weekly schedule (the first such table only)
// Every other table, paragraph and list is ignored, so a plan can carry its own notes and
// progression advice without them turning into exercises.
//
// Exercise names are matched against the library with the CSV importer's matcher. A name that
// matches nothing becomes one of the user's own exercises (the way a CSV import treats it) and is
// reported back, never dropped silently. A plan that says it is for one piece of equipment in its
// title ("... (one 16 kg kettlebell)") steers "Goblet squat" to the kettlebell version, and won't
// settle for a barbell lift when it has no kettlebell one.

import { EXIDX } from './exercises.js'
import { matchExercise, bpFromName } from './import-csv.js'
import { t } from './i18n-core.js'

const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }   // getDay() indexes
const EQUIPMENT = ['kettlebell', 'dumbbell', 'barbell', 'cable', 'band']
const EQUIPMENT_RE = /\b(kettlebell|dumbbell|barbell|cable|band|smith|machine|lever|ez bar|ez barbell|body ?weight|bodyweight)\b/i
const CARDIO = [
  [/\b(run|running|jog|jogging)\b/i, 'run'],
  [/\b(walk|walking)\b/i, 'walk'],
  [/\btreadmill\b/i, 'treadmill'],
  [/\b(cycle|cycling|bike|biking)\b/i, 'cycling'],
  [/\belliptical\b/i, 'elliptical'],
  [/\bswim(ming)?\b/i, 'swim'],
]
const DEFAULT_CARDIO_MIN = 30

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

// Inline Markdown and entities out of a cell or heading; the text underneath is what we read.
const plain = s => String(s == null ? '' : s)
  .replace(/<[^>]+>/g, ' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`~]+/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const normalizeNumbers = s => String(s).toLowerCase().replace(/×/g, 'x').replace(/[–—−]/g, '-')

/** Cells of a pipe-table row, without the empty cells the outer pipes leave. */
function cellsOf(line) {
  const row = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return row.split('|').map(plain)
}
const isTableLine = line => /^\s*\|/.test(line)
const isSeparator = cells => cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')) || c === '')

/**
 * One prescription cell — "3 x 8 to 10", "3 × 30 sec", "2 x 10 per leg", "4 x 15 @ 16 kg" — as the
 * fields a routine entry takes, or null when it doesn't start with a set count.
 * Per-side work stores its TOTAL reps (the routine editor splits them back in two), so 8 per leg
 * is 16 with `side` on. Words it can't turn into numbers ("as many as you can") are kept as a note.
 */
export function parseScheme(cell) {
  let s = normalizeNumbers(plain(cell))
  if (!s) return null
  const out = {}

  const w = s.match(/(\d+(?:[.,]\d+)?)\s*(kgs?|lbs?)\b/)
  if (w) {
    out.weight = clamp(parseFloat(w[1].replace(',', '.')), 0, 2000)
    out.unit = w[2].startsWith('k') ? 'kg' : 'lb'
    s = s.replace(w[0], ' ').replace(/\s@\s|\s@$/g, ' ')
  }
  if (/(per|each|\/)\s*(leg|arm|side|hand)\b/.test(s)) {
    out.side = true
    s = s.replace(/(per|each|\/)\s*(leg|arm|side|hand)\b/g, ' ')
  }

  const m = s.match(/^(\d+)\s*(?:sets?\s*(?:of|x)?|x)\s*(.*)$/)
  if (!m) return null
  out.sets = clamp(parseInt(m[1], 10), 1, 20)
  const rest = m[2].trim()

  const time = rest.match(/^(\d+)(?:\s*(?:-|to)\s*(\d+))?\s*(secs?|seconds?|s|mins?|minutes?)\b/)
  if (time) {
    // The low end of a range is where the first session starts; it is the plan's to grow.
    out.time = { value: parseInt(time[1], 10), minutes: time[3].startsWith('m') }
    return out
  }
  const reps = rest.match(/^(\d+)(?:\s*(?:-|to)\s*(\d+))?/)
  if (reps) {
    const lo = parseInt(reps[1], 10)
    const hi = reps[2] ? parseInt(reps[2], 10) : null
    out.reps = clamp(hi && hi > lo ? hi : lo, 1, 200)
    if (hi && hi > lo) out.repsMin = clamp(lo, 1, 200)
    const leftover = rest.slice(reps[0].length).replace(/\b(reps?|repetitions?|each)\b/g, '').replace(/\s+/g, ' ').trim()
    if (/[a-z]/.test(leftover)) out.note = leftover
    return out
  }
  // "3 x as many as you can", "3 x to failure": a set count with no number to plan around.
  if (/[a-z]/.test(rest)) { out.reps = 10; out.note = rest; return out }
  return null
}

/** "60-90 sec", "2 min", "90" -> whole seconds (the low end of a range), or 0. */
function restSecondsOf(cell) {
  const m = normalizeNumbers(plain(cell)).match(/(\d+)(?:\s*(?:-|to)\s*\d+)?\s*(secs?|seconds?|s|mins?|minutes?)?\b/)
  if (!m) return 0
  const n = parseInt(m[1], 10)
  return clamp(m[2] && m[2].startsWith('m') ? n * 60 : n, 0, 3600)
}

function equipmentHint(title) {
  const found = EQUIPMENT.filter(e => new RegExp('\\b' + e + 's?\\b', 'i').test(title || ''))
  return found.length === 1 ? found[0] : null
}

const wordBag = s => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).sort().join(' ')
const unwrapped = name => name.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
const withoutParens = name => name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()

/** The library id a plan's name refers to, or null. See the header for how the hint steers it. */
function resolveExercise(name, hint) {
  const bare = withoutParens(name)
  if (!bare) return null
  if (hint && !EQUIPMENT_RE.test(name)) {
    // Only the same name counts here. The matcher also settles for a lone entry that merely contains
    // every word, and "kettlebell push-up" would then land on "kettlebell plyo push-up".
    const hinted = hint + ' ' + bare
    const exact = matchExercise(hinted)
    if (exact && EXIDX[exact] && wordBag(EXIDX[exact].n) === wordBag(hinted)) return exact
    const plainId = matchExercise(bare)
    const ex = plainId && EXIDX[plainId]
    // With no version for this piece of equipment, only a lift that needs none will do — a barbell
    // Romanian deadlift is no use to someone who plans with one kettlebell.
    return ex && (ex.eq === hint || ex.eq === 'body weight' || ex.bp === 'cardio') ? plainId : null
  }
  const id = matchExercise(unwrapped(name)) || matchExercise(bare)
  return id && EXIDX[id] ? id : null
}

function equipmentOfName(name) {
  const m = name.match(EQUIPMENT_RE)
  if (!m) return 'custom'
  const eq = m[1].toLowerCase().replace(/\s+/g, ' ')
  return eq === 'bodyweight' ? 'body weight' : eq
}

/**
 * @param {string} text   the Markdown
 * @param {{unit?: 'kg'|'lb'}} [opts]  the reader's unit; weights without a unit in the file are
 *                                     taken to already be in it
 * @returns {{ bundle: object, report: { custom: string[], ignoredTables: number, extraSchedules: number, equipment: string|null } }}
 */
export function parsePlanMarkdown(text, { unit = 'kg' } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n')
  let n = 0
  const nextId = prefix => prefix + (++n)

  let title = ''
  let current = ''            // the latest heading / bold line: the name of the routine below it
  const routines = []         // { name, ex: [] } in file order
  const byName = new Map()
  const custom = new Map()    // lowercased name -> { id, n, bp, eq }
  const scheduleRows = []
  let schedules = 0
  let ignoredTables = 0
  let weightUnit = null

  const routineFor = name => {
    const key = name.toLowerCase()
    if (!byName.has(key)) {
      const r = { id: nextId('r'), name, ex: [] }
      routines.push(r); byName.set(key, r)
    }
    return byName.get(key)
  }

  // The hint comes from the title, which is only known once the whole file has been read for its
  // first "# ..." line — so find it up front.
  const h1 = lines.find(l => /^#\s+\S/.test(l))
  if (h1) title = plain(h1.replace(/^#\s+/, ''))
  const hint = equipmentHint(title)

  const customFor = (name, bpGuess) => {
    const nm = plain(withoutParens(name) || name).toLowerCase()
    if (!custom.has(nm)) {
      custom.set(nm, { id: nextId('c'), n: nm, bp: bpGuess || bpFromName(nm) || 'upper legs', eq: equipmentOfName(nm) === 'custom' && hint ? hint : equipmentOfName(nm) })
    }
    return custom.get(nm)
  }

  // One row/bullet -> the exercises it adds (more than one for "A + B", which is a superset).
  const addExercises = (routine, rawName, scheme, extra = {}) => {
    const names = plain(rawName).split(/\s+\+\s+|\s+&\s+/).map(s => s.trim()).filter(Boolean)
    if (!names.length) return
    const sg = names.length > 1 ? nextId('sgmd') : null
    names.forEach(full => {
      const parenNote = (full.match(/\(([^)]*)\)/g) || []).map(p => p.slice(1, -1).trim()).filter(Boolean).join('; ')
      const id = resolveExercise(full, hint)
      const target = id || customFor(full).id
      const isCardio = id ? EXIDX[id].bp === 'cardio' : false
      const e = { id: target, sets: scheme.sets }
      if (scheme.time) {
        if (isCardio && scheme.time.minutes) e.min = clamp(scheme.time.value, 1, 600)
        else { e.mode = 'time'; e.sec = clamp(scheme.time.minutes ? scheme.time.value * 60 : scheme.time.value, 1, 3600) }
      } else {
        const k = scheme.side ? 2 : 1       // per-side work is stored as the two sides' total
        e.reps = scheme.reps * k
        if (scheme.repsMin) e.repsMin = scheme.repsMin * k
        if (scheme.side) e.side = true
      }
      if (scheme.weight) { e.weight = scheme.weight; if (scheme.unit) weightUnit = weightUnit || scheme.unit }
      if (extra.restSec) e.restSec = extra.restSec
      const note = [parenNote, scheme.note, extra.note].filter(Boolean).join(' · ')
      if (note) e.note = note.slice(0, 200)
      if (sg) e.sg = sg
      routine.ex.push(e)
    })
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    const bold = !heading && line.match(/^\s*\*\*(.+?)\*\*:?\s*$/)
    if (heading) {
      // The "# Title" line names the plan, not a routine.
      current = heading[1].length === 1 ? '' : plain(heading[2]).replace(/:$/, '')
      i++; continue
    }
    if (bold) { current = plain(bold[1]).replace(/:$/, ''); i++; continue }

    if (isTableLine(line)) {
      const block = []
      while (i < lines.length && isTableLine(lines[i])) block.push(cellsOf(lines[i++]))
      const header = block[0].map(c => c.toLowerCase())
      const body = block.slice(1).filter(r => !isSeparator(r))
      const col = re => header.findIndex(c => re.test(c))
      const exI = col(/exercise|movement|\blift\b/)
      const schI = col(/sets?\s*(x|\/)\s*reps?|scheme|prescription/)
      const setsI = col(/^sets?$/)
      const repsI = col(/^(reps?|rep range|time|duration)$/)
      const dayI = col(/\bday\b/)
      const sessI = col(/session|workout|routine|plan|training|activity/)
      if (exI >= 0 && (schI >= 0 || (setsI >= 0 && repsI >= 0))) {
        if (!current) { ignoredTables++; continue }
        const routine = routineFor(current)
        const weightI = col(/weight|load/), restI = col(/^rest/), noteI = col(/note|comment|cue/)
        const timeCol = repsI >= 0 && /time|duration/.test(header[repsI])
        body.forEach(r => {
          let cell = schI >= 0 ? r[schI] : `${r[setsI]} x ${r[repsI]}`
          if (schI < 0 && timeCol && /^\d+$/.test((r[repsI] || '').trim())) cell = `${r[setsI]} x ${r[repsI]} sec`
          if (weightI >= 0 && r[weightI] && /\d/.test(r[weightI]) && !/\b(kg|lbs?)\b/i.test(cell)) cell += ' @ ' + r[weightI]
          const scheme = parseScheme(cell)
          if (!scheme || !r[exI]) return
          addExercises(routine, r[exI], scheme, {
            restSec: restI >= 0 ? restSecondsOf(r[restI]) : 0,
            note: noteI >= 0 ? r[noteI] : ''
          })
        })
      } else if (dayI >= 0 && sessI >= 0 && exI < 0) {
        schedules++
        if (schedules === 1) body.forEach(r => scheduleRows.push([r[dayI], r[sessI]]))
      } else {
        ignoredTables++
      }
      continue
    }

    const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*(?::|[–—]|\s-\s|\s@\s|\|)\s*(\d+\s*(?:x|×)\s*\S.*)$/)
    if (bullet && current) {
      const scheme = parseScheme(bullet[2])
      if (scheme) addExercises(routineFor(current), bullet[1], scheme)
    }
    i++
  }

  // Schedule cells name routines ("Day A", "Day A, then a 30 min easy run") or cardio ("Run, 30 min
  // easy"). A cardio session no routine covers becomes its own small routine.
  const week = {}
  const knownRoutine = piece => {
    const p = piece.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/^(a|an|the)\s+/, '').trim()
    return routines.find(r => {
      const rn = r.name.toLowerCase()
      return p === rn || p.startsWith(rn + ' ') || new RegExp('\\b' + rn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(p)
    })
  }
  scheduleRows.forEach(([dayCell, sessionCell]) => {
    const day = WEEKDAY[(plain(dayCell).toLowerCase().match(/^[a-z]{3}/) || [''])[0]]
    if (day === undefined) return
    const cellMinutes = (normalizeNumbers(sessionCell).match(/(\d+)\s*(?:min|minutes?)\b/) || [])[1]
    const ids = []
    plain(sessionCell).split(/,|\+|\bthen\b|&|\band\b/i).map(s => s.trim()).filter(Boolean).forEach(piece => {
      const known = knownRoutine(piece)
      if (known) { if (!ids.includes(known.id)) ids.push(known.id); return }
      const hit = CARDIO.find(([re]) => re.test(piece))
      if (!hit) return                                             // "Rest", "30 min easy", "optional"
      const minutes = (normalizeNumbers(piece).match(/(\d+)\s*(?:min|minutes?)\b/) || [])[1] || cellMinutes
      const routine = routineFor(cap(hit[1]))
      if (!routine.ex.length) {
        const id = matchExercise(hit[1])
        const lib = id && EXIDX[id] && EXIDX[id].bp === 'cardio' ? id : null
        routine.ex.push({ id: lib || customFor(hit[1], 'cardio').id, sets: 1, mode: 'cardio', min: clamp(parseInt(minutes, 10) || DEFAULT_CARDIO_MIN, 1, 600) })
      }
      if (!ids.includes(routine.id)) ids.push(routine.id)
    })
    if (ids.length) week[day] = ids
  })

  const usable = routines.filter(r => r.ex.length)
  if (!usable.length) throw new Error(t('no routines found in this file'))
  const keep = new Set(usable.map(r => r.id))
  Object.keys(week).forEach(d => { week[d] = week[d].filter(id => keep.has(id)); if (!week[d].length) delete week[d] })
  const usedIds = new Set(usable.flatMap(r => r.ex.map(e => e.id)))
  const customEx = [...custom.values()].filter(c => usedIds.has(c.id))

  return {
    bundle: {
      opengym_plan: 1, name: title, unit: weightUnit || unit, week,
      routines: usable.map(r => ({ id: r.id, name: r.name, ex: r.ex })),
      customEx
    },
    report: { custom: customEx.map(c => c.n), ignoredTables, extraSchedules: Math.max(0, schedules - 1), equipment: hint }
  }
}
