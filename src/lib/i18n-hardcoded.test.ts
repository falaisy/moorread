import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const intentionalRuntimeHan = new Map<string, Set<string>>([
  ['src/lib/bookmark-search.ts', new Set([
    '阿',
    '芭',
    '擦',
    '搭',
    '蛾',
    '发',
    '噶',
    '哈',
    '击',
    '喀',
    '垃',
    '妈',
    '拿',
    '哦',
    '啪',
    '期',
    '然',
    '撒',
    '塌',
    '挖',
    '昔',
    '压',
    '匝',
  ])],
  // 字體家族名稱是作業系統上的專有名詞，不是可翻譯的介面文案。
  ['src/lib/fonts.ts', new Set([
    '微軟正黑體',
    '新細明體',
    '標楷體',
    '蘋方 TC',
    '蘋方-繁',
    '微軟雅黑',
    '微软雅黑',
    '宋體',
    '宋体',
    '黑體',
    '黑体',
    '楷體',
    '楷体',
    '等線',
    '等线',
    '蘋方 SC',
    '苹方-简',
    '華文黑體',
    '华文黑体',
    '思源黑體',
    '思源宋體',
    '霞鶩文楷',
    '霞鹜文楷',
    '得意黑',
    '芫荽',
    'jf open 粉圓',
    '阿里巴巴普惠體',
    '阿里巴巴普惠体',
    'mmmmmmmmmmlliWWWWW書野測試字體0123456789',
  ])],
  ['src/lib/default-data.ts', new Set([
    '全部',
    '常用',
    '最近',
    '收件箱',
    '置顶',
    '无标签',
    '无描述',
  ])],
])

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(absolute) : [absolute]
  })
}

describe('i18n hard-coded copy gate', () => {
  it('keeps Han UI copy inside translation catalogs', () => {
    const unexpected: string[] = []
    const files = sourceFiles(path.resolve('src')).filter((file) => {
      const name = path.basename(file)
      return /\.(?:ts|tsx)$/.test(file)
        && !name.includes('.test.')
        && !name.startsWith('i18n')
    })

    for (const file of files) {
      const relative = path.relative(process.cwd(), file).split(path.sep).join('/')
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      const visit = (node: ts.Node) => {
        const value = ts.isStringLiteral(node)
          || ts.isNoSubstitutionTemplateLiteral(node)
          ? node.text
          : ts.isJsxText(node)
            ? node.getText(source).trim()
            : ''
        if (/\p{Script=Han}/u.test(value)
          && !intentionalRuntimeHan.get(relative)?.has(value)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
          unexpected.push(`${relative}:${line + 1}: ${JSON.stringify(value)}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }

    expect(unexpected).toEqual([])
  })
})
