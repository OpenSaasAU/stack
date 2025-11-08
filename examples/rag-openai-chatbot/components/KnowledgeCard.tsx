interface KnowledgeCardProps {
  title: string
  content: string
  category: string
  score?: number
}

const categoryColors: Record<string, string> = {
  'ai-ml': 'bg-purple-100 text-purple-800',
  'web-dev': 'bg-blue-100 text-blue-800',
  'software-eng': 'bg-green-100 text-green-800',
  database: 'bg-yellow-100 text-yellow-800',
  devops: 'bg-orange-100 text-orange-800',
}

const categoryLabels: Record<string, string> = {
  'ai-ml': 'AI/ML',
  'web-dev': 'Web Development',
  'software-eng': 'Software Engineering',
  database: 'Database',
  devops: 'DevOps',
}

export function KnowledgeCard({ title, content, category, score }: KnowledgeCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900 flex-1">{title}</h3>
        {score !== undefined && (
          <span className="ml-3 text-sm font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded">
            {Math.round(score * 100)}% match
          </span>
        )}
      </div>

      <div className="mb-3">
        <span
          className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded ${
            categoryColors[category] || 'bg-gray-100 text-gray-800'
          }`}
        >
          {categoryLabels[category] || category}
        </span>
      </div>

      <p className="text-gray-700 text-sm leading-relaxed line-clamp-3">{content}</p>
    </div>
  )
}
