import { Link } from "react-router-dom"

interface Tool {
  id: string
  title: string
  description: string
  path: string
  icon?: string
}

const tools: Tool[] = [
  {
    id: "pdf-cropper",
    title: "PDF Cropper",
    description: "Crop PDF pages with a visual interface. Upload a PDF, draw crop rectangles, and export the cropped version.",
    path: "/pdf-cropper",
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto px-4 py-16 max-w-6xl">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            PDF Tools
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            A collection of useful PDF manipulation tools
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
          {tools.map((tool) => (
            <Link
              key={tool.id}
              to={tool.path}
              className="group block bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-lg hover:border-gray-300 transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 group-hover:text-gray-700">
                  {tool.title}
                </h2>
                {tool.icon && (
                  <span className="text-2xl">{tool.icon}</span>
                )}
              </div>
              <p className="text-gray-600 text-sm leading-relaxed">
                {tool.description}
              </p>
              <div className="mt-4 text-sm font-medium text-gray-500 group-hover:text-gray-700">
                Open tool →
              </div>
            </Link>
          ))}
        </div>

        <footer className="mt-16 text-center text-gray-500 text-sm">
          <p>More tools coming soon...</p>
        </footer>
      </div>
    </div>
  )
}
