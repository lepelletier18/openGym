import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parsePlanMarkdown, parseScheme } from './import-plan-md.js'
import { parsePlan, mergePlan } from './plan-share.js'
import { exLine } from './history.js'

const sample = readFileSync(new URL('../../../docs/examples/beginner-kettlebell-plan.md', import.meta.url), 'utf8')
const parse = (md, opts) => parsePlanMarkdown(md, opts)
const byName = (bundle, name) => bundle.routines.find(r => r.name === name)

describe('parseScheme', () => {
  it('reads sets x reps, with either kind of x and a range written three ways', () => {
    expect(parseScheme('3 x 12')).toMatchObject({ sets: 3, reps: 12 })
    expect(parseScheme('3 × 8–10')).toMatchObject({ sets: 3, reps: 10, repsMin: 8 })
    expect(parseScheme('3 x 8 to 10')).toMatchObject({ sets: 3, reps: 10, repsMin: 8 })
    expect(parseScheme('4 x 15').repsMin).toBeUndefined()
  })

  it('stores per-side work as the two sides’ total, the way the routine editor does', () => {
    expect(parseScheme('3 x 8 to 10 per leg')).toMatchObject({ reps: 10, repsMin: 8, side: true })
    expect(parseScheme('3 x 12 each side')).toMatchObject({ reps: 12, side: true })
    expect(parseScheme('3 x 30 sec per side')).toMatchObject({ time: { value: 30, minutes: false }, side: true })
  })

  it('reads a hold or a cardio block as time, from its low end', () => {
    expect(parseScheme('3 x 30 to 45 sec').time).toEqual({ value: 30, minutes: false })
    expect(parseScheme('1 x 20 min').time).toEqual({ value: 20, minutes: true })
  })

  it('takes a load and its unit, and keeps words it cannot plan around as a note', () => {
    expect(parseScheme('4 x 15 @ 16 kg')).toMatchObject({ sets: 4, reps: 15, weight: 16, unit: 'kg' })
    expect(parseScheme('3 x 5 at 135 lbs')).toMatchObject({ weight: 135, unit: 'lb' })
    expect(parseScheme('3 x as many as you can')).toMatchObject({ sets: 3, reps: 10, note: 'as many as you can' })
    expect(parseScheme('2 x 10 each').note).toBeUndefined()
  })

  it('refuses a cell that does not start with a set count', () => {
    expect(parseScheme('Rest 60 seconds')).toBeNull()
    expect(parseScheme('')).toBeNull()
    expect(parseScheme('12')).toBeNull()
  })

  it('keeps absurd numbers inside what the planner accepts', () => {
    expect(parseScheme('999 x 9999')).toMatchObject({ sets: 20, reps: 200 })
  })
})

describe('a markdown plan with tables', () => {
  const { bundle, report } = parse(sample)

  it('makes one routine per exercise table, plus one for the run the schedule mentions', () => {
    expect(bundle.routines.map(r => r.name)).toEqual(['Day A', 'Day B', 'Day C', 'Run'])
    expect(bundle.routines.map(r => r.ex.length)).toEqual([5, 5, 6, 1])
    expect(bundle.name).toMatch(/^Beginner plan/)
  })

  it('ignores the progression tables and a second schedule', () => {
    expect(report.ignoredTables).toBe(1)
    expect(report.extraSchedules).toBe(1)
    const names = bundle.routines.map(r => r.name)
    expect(names).not.toContain('How to progress (one fixed weight, so make each rep harder)')
  })

  it('schedules the first table, with the run on its own days', () => {
    const id = n => byName(bundle, n).id
    expect(bundle.week).toEqual({
      1: [id('Day A')], 2: [id('Run')], 3: [id('Day B')], 4: [id('Run')], 5: [id('Day C')], 6: [id('Run')],
    })
  })

  it('steers to the kettlebell version when the title names one piece of equipment', () => {
    expect(report.equipment).toBe('kettlebell')
    const dayA = byName(bundle, 'Day A').ex
    expect(dayA[0].id).toBe('0534')                    // kettlebell goblet squat, not the dumbbell one
    expect(dayA[3].id).toBe('0549')                    // kettlebell swing
    expect(byName(bundle, 'Day B').ex[2].id).toBe('0662')   // a plain push-up is fine: no load to be wrong about
  })

  it('does not settle for a barbell lift when there is no kettlebell one, and says so', () => {
    expect(report.custom).toContain('kettlebell romanian deadlift')
    expect(bundle.routines.flatMap(r => r.ex).some(e => e.id === '0085')).toBe(false)
  })

  it('writes per-side, timed, ranged and superset work the way a routine stores it', () => {
    const [squat, press, row, swing, plank] = byName(bundle, 'Day A').ex
    expect(squat).toMatchObject({ sets: 3, reps: 15, repsMin: 12 })
    expect(press).toMatchObject({ sets: 3, reps: 20, repsMin: 16, side: true })
    expect(row.note).toBe('free hand on a chair or bench')
    expect(swing).toMatchObject({ sets: 4, reps: 15, repsMin: 12 })
    expect(plank).toMatchObject({ mode: 'time', sec: 30 })
    const [halo, deadBug] = byName(bundle, 'Day C').ex.slice(-2)
    expect(halo.sg).toBeTruthy()
    expect(halo.sg).toBe(deadBug.sg)
    expect(halo).toMatchObject({ sets: 2, reps: 10 })
    expect(deadBug.note).toBeUndefined()
  })

  it('turns "Run, 30 min easy" into a cardio routine of that length', () => {
    expect(byName(bundle, 'Run').ex).toEqual([{ id: '0685', sets: 1, mode: 'cardio', min: 30 }])
  })

  it('shows a ranged exercise as the range, the way the routine editor does', () => {
    expect(exLine(byName(bundle, 'Day A').ex[0], 'kg')).toBe('3 × 12–15')
  })

  it('goes through parsePlan untouched: nothing dropped, every custom exercise carried', () => {
    const parsed = parsePlan(bundle, 'kg')
    expect(parsed.dropped).toBe(0)
    expect(parsed.routineCount).toBe(4)
    expect(parsed.scheduledDays).toBe(6)
  })

  it('merges as new routines and, when asked, replaces the week', () => {
    const s = { unit: 'kg', routines: [{ id: 'mine', name: 'Mine', ex: [] }], week: { 0: ['mine'] }, customEx: [] }
    mergePlan(s, parsePlan(bundle, 'kg'), { schedule: true })
    expect(s.routines).toHaveLength(5)
    expect(s.routines[0].id).toBe('mine')
    expect(s.week[0]).toBeUndefined()
    expect(Object.keys(s.week).sort()).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(s.customEx.every(c => c.custom)).toBe(true)
    const plank = s.customEx.find(c => c.n === 'plank')
    expect(plank).toMatchObject({ bp: 'waist' })
    const dayA = s.routines.find(r => r.name === 'Day A')
    expect(dayA.ex[4].id).toBe(plank.id)       // the routine points at the freshly made exercise
  })
})

describe('without a piece of equipment named', () => {
  it('uses the library’s usual version of a lift', () => {
    const { bundle, report } = parse('# Plan\n\n## Legs\n\n| Exercise | Sets x reps |\n|---|---|\n| Goblet squat | 3 x 10 |\n| Romanian deadlift | 3 x 8 |\n')
    expect(report.equipment).toBeNull()
    expect(bundle.routines[0].ex.map(e => e.id)).toEqual(['1760', '0085'])
    expect(report.custom).toEqual([])
  })

  it('does not let a hint override an equipment the exercise names itself', () => {
    const { bundle } = parse('# Home plan (kettlebell)\n\n## A\n\n| Exercise | Sets x reps |\n|---|---|\n| Barbell back squat | 3 x 5 |\n')
    expect(bundle.routines[0].ex[0].id).toBe('0043')
  })
})

describe('other shapes of the same plan', () => {
  it('reads separate Sets and Reps columns, with weight, rest and notes', () => {
    const md = [
      '# Upper', '', '## Push day', '',
      '| Exercise | Sets | Reps | Weight | Rest | Notes |',
      '|---|---|---|---|---|---|',
      '| Barbell bench press | 3 | 5 | 60 kg | 2 min | Pause on the chest |',
      '| Lateral raise | 2 | 12-15 | | 60-90 sec | |',
    ].join('\n')
    const { bundle } = parse(md)
    const [bench, lateral] = bundle.routines[0].ex
    expect(bench).toMatchObject({ id: '0025', sets: 3, reps: 5, weight: 60, restSec: 120, note: 'Pause on the chest' })
    expect(lateral).toMatchObject({ id: '0334', sets: 2, reps: 15, repsMin: 12, restSec: 60 })
    expect(bundle.unit).toBe('kg')
  })

  it('reads a bullet list under a heading, and a bold line as a heading', () => {
    const md = [
      '**Lower body**', '',
      '- Barbell back squat: 3 x 5',
      '- Lying leg curl - 3 x 10 to 12',
      '- Standing calf raise @ 4 x 15',
      '- Warm up for ten minutes first',
    ].join('\n')
    const { bundle } = parse(md)
    expect(bundle.routines).toHaveLength(1)
    expect(bundle.routines[0].name).toBe('Lower body')
    expect(bundle.routines[0].ex.map(e => e.id)).toEqual(['0043', '0586', '1372'])
  })

  it('declares pounds when the file uses them, so the import converts', () => {
    const md = '## A\n\n- Barbell bench press: 3 x 5 @ 135 lb\n'
    const { bundle } = parse(md, { unit: 'kg' })
    expect(bundle.unit).toBe('lb')
    expect(parsePlan(bundle, 'kg').routines[0].ex[0].weight).toBeCloseTo(61.2, 1)
  })

  it('merges two tables under one heading into one routine', () => {
    const md = '## A\n\n| Exercise | Sets x reps |\n|-|-|\n| Barbell squat | 3 x 5 |\n\nThen:\n\n| Exercise | Sets x reps |\n|-|-|\n| Lying leg curl | 3 x 10 |\n'
    expect(parse(md).bundle.routines[0].ex).toHaveLength(2)
  })

  it('copes with Windows line endings and a byte-order mark', () => {
    const md = '﻿## A\r\n\r\n| Exercise | Sets x reps |\r\n|---|---|\r\n| Lying leg curl | 3 x 10 |\r\n'
    expect(parse(md).bundle.routines[0].ex[0].id).toBe('0586')
  })

  it('schedules a day that holds a lift and a run', () => {
    const md = '## A\n\n- Lying leg curl: 3 x 10\n\n| Day | Session |\n|---|---|\n| Monday | A, then a 25 min easy run |\n| Tuesday | Rest |\n'
    const { bundle } = parse(md)
    const run = byName(bundle, 'Run')
    expect(run.ex[0].min).toBe(25)
    expect(bundle.week).toEqual({ 1: [byName(bundle, 'A').id, run.id] })
  })

  it('does not mistake prose for exercises', () => {
    const md = '## Notes\n\n- Rest 60 seconds between sets\n- Swing: it is a hip hinge\n\n| Exercise | Move up when |\n|---|---|\n| Swing | 5 x 20 |\n'
    expect(() => parse(md)).toThrow(/no routines/)
  })

  it('says so when there is nothing to import', () => {
    expect(() => parse('')).toThrow(/no routines/)
    expect(() => parse('# Just a title\n\nSome words.')).toThrow(/no routines/)
  })

  it('makes an exercise it cannot match into one of the reader’s own, with a body part and equipment', () => {
    const { bundle, report } = parse('## A\n\n- Zercher kettlebell carry: 3 x 20 sec\n')
    expect(report.custom).toEqual(['zercher kettlebell carry'])
    expect(bundle.customEx[0]).toMatchObject({ n: 'zercher kettlebell carry', eq: 'kettlebell' })
    expect(bundle.routines[0].ex[0]).toMatchObject({ id: bundle.customEx[0].id, mode: 'time', sec: 20 })
  })
})
