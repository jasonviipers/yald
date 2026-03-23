import type { ReactNode } from 'react'
import {
  SparkleIcon,
  CurrencyDollarIcon,
  TrashIcon,
  CpuIcon,
  QuestionIcon
} from '@phosphor-icons/react'

export interface SlashCommand {
  command: string
  description: string
  icon: ReactNode
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation', icon: <TrashIcon size={11} /> },
  { command: '/cost', description: 'Show usage & cost', icon: <CurrencyDollarIcon size={11} /> },
  { command: '/skills', description: 'Available skills', icon: <SparkleIcon size={11} /> },
  { command: '/model', description: 'Switch model', icon: <CpuIcon size={11} /> },
  { command: '/help', description: 'Show all commands', icon: <QuestionIcon size={11} /> }
]

export function getFilteredCommands(filter: string): SlashCommand[] {
  return getFilteredCommandsWithExtras(filter, [])
}

export function getFilteredCommandsWithExtras(
  filter: string,
  extraCommands: SlashCommand[]
): SlashCommand[] {
  const query = filter.toLowerCase()
  const merged = [...SLASH_COMMANDS]
  for (const command of extraCommands) {
    if (!merged.some((item) => item.command === command.command)) merged.push(command)
  }
  return merged.filter((command) => command.command.startsWith(query))
}
