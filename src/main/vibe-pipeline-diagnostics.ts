import type { DiagnosticEntry, DiagnosticReport } from './vibe-pipeline-types'

const DIAGNOSTIC_TAIL_LINES = 60

const MISSING_DEP_PATTERNS: RegExp[] = [
  /Cannot find module ['"]([^'"]+)['"]/,
  /Module not found.*['"]([^'"]+)['"]/,
  /Cannot resolve.*['"]([^'"]+)['"]/,
  /Error: Cannot find package '([^']+)'/,
  /npm ERR! 404.*'([^']+)'/,
  /Could not resolve ['"]([^'"]+)['"]/,
  /Package subpath '([^']+)' is not defined/
]

const MISSING_FILE_PATTERNS: RegExp[] = [
  /ENOENT.*no such file.*'([^']+)'/i,
  /Cannot find.*file.*['"]([^'"]+)['"]/i,
  /Failed to resolve import.*['"]([^'"]+)['"]/i
]

const TYPE_ERROR_PATTERNS: RegExp[] = [
  /TS\d{4}:/,
  /Failed to compile\./i,
  /JSX element type '.*' does not have any construct or call signatures/,
  /JSX element type '.*' is not a constructor function for JSX elements/,
  /JSX element class does not support attributes/,
  /Type '.*' is not assignable/,
  /Argument of type '.*' is not assignable/,
  /Property '.*' does not exist on type/,
  /Object is possibly '(null|undefined)'/,
  /does not have any construct or call signatures/,
  /is not a function/,
  /is not callable/,
  /has no exported member/,
  /Module '.*' has no default export/,
  /Module '.*' has no exported member/
]

const SYNTAX_ERROR_PATTERNS: RegExp[] = [
  /SyntaxError:/,
  /Unexpected token/,
  /Unexpected end of/,
  /Expected.*but found/,
  /Parsing error:/
]

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function extractTypeErrorLocations(lines: string[]): string[] {
  const locations: string[] = []
  const tscLocationPattern = /(?:^|\s)(\.\.?\/[^\s:]+\.tsx?):(\d+):\d+/gm
  const vsLocationPattern = /([^\s(]+\.tsx?)\((\d+),\d+\)/gm
  const combined = lines.join('\n')

  let match: RegExpExecArray | null
  tscLocationPattern.lastIndex = 0
  while ((match = tscLocationPattern.exec(combined)) !== null) {
    locations.push(`${match[1]}:${match[2]}`)
  }

  vsLocationPattern.lastIndex = 0
  while ((match = vsLocationPattern.exec(combined)) !== null) {
    locations.push(`${match[1]}:${match[2]}`)
  }

  return uniqueStrings(locations)
}

export function classifyDiagnosticEntries(entries: DiagnosticEntry[]): DiagnosticReport {
  const errorLines = entries
    .filter(
      (entry) => entry.level === 'error' || entry.source === 'stderr' || entry.source === 'build'
    )
    .map((entry) => entry.message)
  const infoLines = entries
    .filter((entry) => entry.level === 'info' && entry.source !== 'build')
    .map((entry) => entry.message)

  const missingPackages: string[] = []
  const affectedFiles: string[] = []
  const errorMessages: string[] = []

  for (const line of errorLines) {
    for (const pattern of MISSING_DEP_PATTERNS) {
      const match = pattern.exec(line)
      if (!match) continue
      const pkg = match[1]
      if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
        missingPackages.push(pkg.split('/')[0])
      }
    }

    for (const pattern of MISSING_FILE_PATTERNS) {
      const match = pattern.exec(line)
      if (match) affectedFiles.push(match[1])
    }

    if (line.trim()) errorMessages.push(line.trim())
  }

  const combined = errorLines.join('\n')
  let category: DiagnosticReport['category'] = 'unknown'

  if (missingPackages.length > 0) {
    category = 'missing_dependency'
  } else if (TYPE_ERROR_PATTERNS.some((pattern) => pattern.test(combined))) {
    category = 'type_error'
    for (const location of extractTypeErrorLocations(errorLines)) affectedFiles.push(location)
  } else if (SYNTAX_ERROR_PATTERNS.some((pattern) => pattern.test(combined))) {
    category = 'syntax_error'
    for (const location of extractTypeErrorLocations(errorLines)) affectedFiles.push(location)
  } else if (affectedFiles.length > 0) {
    category = 'missing_file'
  } else if (errorLines.some((line) => /crash|uncaught|unhandled|fatal/i.test(line))) {
    category = 'runtime_crash'
  } else if (
    infoLines.some((line) => /port|EADDRINUSE|listen/i.test(line)) &&
    errorLines.length === 0
  ) {
    category = 'port_not_exposed'
  }

  let categoryHint = ''
  if (category === 'type_error') {
    const isJsxSignatureError =
      /does not have any construct or call signatures|JSX element type/i.test(combined)
    const isNoDefaultExport = /has no default export|Module .* has no exported member/i.test(
      combined
    )
    if (isJsxSignatureError) {
      categoryHint = [
        'DIAGNOSIS: A React component is exported in a way TypeScript cannot call as a JSX element.',
        'COMMON CAUSES:',
        '  1. The component file exports a class without extending React.Component/PureComponent.',
        '  2. The component is exported as a plain object or non-function value.',
        '  3. The component file exports an async function (async components are not valid in all contexts).',
        '  4. A named export is used as a default import or vice-versa.',
        'FIX: Ensure every component referenced in JSX is a standard React functional component:',
        '  export default function Hero(): JSX.Element { return <div>...</div> }',
        '  OR as a named export: export function Hero(): JSX.Element { return <div>...</div> }',
        'Do NOT export classes (without extends React.Component), plain objects, or async functions as JSX components.',
        'Also verify the import site matches the export style (default vs named).'
      ].join('\n')
    } else if (isNoDefaultExport) {
      categoryHint = [
        'DIAGNOSIS: A file is imported expecting a default export but none exists.',
        'FIX: Add `export default` to the relevant function/class/value, or change the import to a named import.'
      ].join('\n')
    } else {
      categoryHint =
        'DIAGNOSIS: TypeScript type mismatch. Correct the type annotations or the value being passed to match the expected type.'
    }
  } else if (category === 'syntax_error') {
    categoryHint =
      'DIAGNOSIS: Syntax error in the file. Fix the malformed code — check for unclosed braces, missing commas, invalid JSX, or stray characters.'
  } else if (category === 'missing_file') {
    categoryHint =
      'DIAGNOSIS: A file referenced by an import does not exist. Either create the missing file or correct the import path.'
  }

  const errorTail = entries
    .filter(
      (entry) => entry.level === 'error' || entry.source === 'build' || entry.source === 'stderr'
    )
    .slice(-DIAGNOSTIC_TAIL_LINES)
    .map((entry) => `[${entry.source}] ${entry.message}`)
    .join('\n')

  const fixContext = [
    `FAILURE CATEGORY: ${category}`,
    categoryHint ? `\n${categoryHint}` : '',
    missingPackages.length > 0
      ? `MISSING PACKAGES: ${uniqueStrings(missingPackages).join(', ')}`
      : '',
    uniqueStrings(affectedFiles).length > 0
      ? `AFFECTED FILES (with line numbers where available):\n  ${uniqueStrings(affectedFiles).join('\n  ')}`
      : '',
    `KEY ERRORS (most recent first):\n${errorMessages.slice(0, 20).join('\n')}`,
    errorTail ? `\nBUILD ERROR LOG TAIL:\n${errorTail}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    category,
    affectedFiles: uniqueStrings(affectedFiles),
    missingPackages: uniqueStrings(missingPackages),
    errorMessages: uniqueStrings(errorMessages).slice(0, 20),
    fixContext
  }
}
