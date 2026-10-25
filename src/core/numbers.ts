/**
 * How a language writes the numbers 0 to 99 in words: the words for 0 to 19 (some numbers in
 * several forms, by gender, case or speech: "en" and "ett", "две", "ένας"), the tens from 20, and how a ten
 * and a unit make one number.
 */
interface NumberWords {
  units: readonly (readonly string[])[]
  tens: readonly string[]
  /** A ten and a unit as one number, as spelled with no spaces ("twentyone", "einundzwanzig"). */
  compound: (ten: string, unit: string) => string
}

const LANGUAGES: Record<string, NumberWords> = {
  en: {
    units: [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
      'sixteen',
      'seventeen',
      'eighteen',
      'nineteen',
    ].map((word) => [word]),
    tens: 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' '),
    compound: (ten, unit) => ten + unit,
  },
  sv: {
    units: [
      ['noll'],
      ['ett', 'en'],
      ['två'],
      ['tre'],
      ['fyra'],
      ['fem'],
      ['sex'],
      ['sju'],
      ['åtta'],
      ['nio'],
      ['tio'],
      ['elva'],
      ['tolv'],
      ['tretton'],
      ['fjorton'],
      ['femton'],
      ['sexton'],
      ['sjutton'],
      ['arton'],
      ['nitton'],
    ],
    tens: 'tjugo trettio fyrtio femtio sextio sjuttio åttio nittio'.split(' '),
    compound: (ten, unit) => ten + unit,
  },
  de: {
    units: [
      ['null'],
      ['eins'],
      ['zwei', 'zwo'],
      ['drei'],
      ['vier'],
      ['fünf'],
      ['sechs'],
      ['sieben'],
      ['acht'],
      ['neun'],
      ['zehn'],
      ['elf'],
      ['zwölf'],
      ['dreizehn'],
      ['vierzehn'],
      ['fünfzehn'],
      ['sechzehn'],
      ['siebzehn'],
      ['achtzehn'],
      ['neunzehn'],
    ],
    tens: 'zwanzig dreißig vierzig fünfzig sechzig siebzig achtzig neunzig'.split(' '),
    // The unit first: "einundzwanzig", one as "ein".
    compound: (ten, unit) => `${unit === 'eins' ? 'ein' : unit}und${ten}`,
  },
  el: {
    units: [
      ['μηδέν'],
      ['ένα', 'ένας', 'μία', 'μια', 'ενός', 'μιας'],
      ['δύο'],
      ['τρία', 'τρεις', 'τριών'],
      ['τέσσερα', 'τέσσερις'],
      ['πέντε'],
      ['έξι'],
      ['επτά', 'εφτά'],
      ['οκτώ', 'οχτώ'],
      ['εννέα', 'εννιά'],
      ['δέκα'],
      ['έντεκα'],
      ['δώδεκα'],
      ['δεκατρία', 'δεκατρείς'],
      ['δεκατέσσερα', 'δεκατέσσερις'],
      ['δεκαπέντε'],
      ['δεκαέξι'],
      ['δεκαεπτά', 'δεκαεφτά'],
      ['δεκαοκτώ', 'δεκαοχτώ'],
      ['δεκαεννέα', 'δεκαεννιά'],
    ],
    tens: 'είκοσι τριάντα σαράντα πενήντα εξήντα εβδομήντα ογδόντα ενενήντα'.split(' '),
    compound: (ten, unit) => ten + unit,
  },
  ru: {
    units: [
      ['ноль', 'нуль'],
      ['один', 'одна', 'одно', 'одну', 'одного', 'одной'],
      ['два', 'две', 'двух'],
      ['три', 'трёх'],
      ['четыре', 'четырёх'],
      ['пять'],
      ['шесть'],
      ['семь'],
      ['восемь'],
      ['девять'],
      ['десять'],
      ['одиннадцать'],
      ['двенадцать'],
      ['тринадцать'],
      ['четырнадцать'],
      ['пятнадцать'],
      ['шестнадцать'],
      ['семнадцать'],
      ['восемнадцать'],
      ['девятнадцать'],
    ],
    tens: 'двадцать тридцать сорок пятьдесят шестьдесят семьдесят восемьдесят девяносто'.split(' '),
    compound: (ten, unit) => ten + unit,
  },
}

/** The language part of a language code, lower-cased: `en-GB` is `en`. */
export function baseLanguage(code: string): string {
  return code.split('-')[0]!.toLowerCase()
}

/**
 * The numbers 0 to 99 of a language as groups of the words that write them and the digits Whisper
 * writes instead ("twenty", "20"; "twentyone", "21": a number of two words is matched run
 * together, see `spelledBy` in `align`). Only English, Swedish, German, Greek and Russian, by the
 * code's language part (`en-GB` is `en`); none for another language.
 */
export function numberWords(language: string): string[][] {
  const words = LANGUAGES[baseLanguage(language)]
  if (!words) return []
  const groups = words.units.map((forms, n) => [String(n), ...forms])
  words.tens.forEach((ten, t) => {
    groups.push([String(20 + 10 * t), ten])
    for (let unit = 1; unit < 10; unit++) {
      const forms = words.units[unit]!.map((form) => words.compound(ten, form))
      groups.push([String(20 + 10 * t + unit), ...forms])
    }
  })
  return groups
}
