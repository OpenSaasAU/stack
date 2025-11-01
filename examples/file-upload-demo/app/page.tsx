import Link from 'next/link'
import { Button } from '@opensaas/stack-ui/primitives'

export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-2xl w-full mx-auto p-8">
        <div className="bg-white rounded-lg shadow-xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold text-gray-900">
              File Upload Demo
            </h1>
            <p className="text-gray-600">
              Demonstration of OpenSaas Stack file and image upload capabilities
            </p>
          </div>

          <div className="grid gap-4 pt-4">
            <div className="border rounded-lg p-6 space-y-3">
              <h2 className="text-xl font-semibold">Admin Dashboard</h2>
              <p className="text-gray-600">
                Access the admin UI to manage users and posts with file uploads
              </p>
              <Link href="/admin">
                <Button className="w-full">Go to Admin Dashboard</Button>
              </Link>
            </div>

            <div className="border rounded-lg p-6 space-y-3">
              <h2 className="text-xl font-semibold">Custom Upload Form</h2>
              <p className="text-gray-600">
                See a custom form implementation with file uploads
              </p>
              <Link href="/custom-form">
                <Button variant="outline" className="w-full">
                  View Custom Form
                </Button>
              </Link>
            </div>
          </div>

          <div className="pt-6 border-t space-y-4">
            <h3 className="font-semibold text-lg">Features Demonstrated:</h3>
            <ul className="space-y-2 text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-1">✓</span>
                <span>Image uploads with automatic transformations (thumbnail, profile)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-1">✓</span>
                <span>File uploads (PDF, Word documents)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-1">✓</span>
                <span>Multiple named storage providers (avatars, documents)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-1">✓</span>
                <span>Validation (file size, MIME types)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-1">✓</span>
                <span>Drag-and-drop upload UI</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-600 mt-1">✓</span>
                <span>Client-side preview for images</span>
              </li>
            </ul>
          </div>

          <div className="pt-4 text-sm text-gray-500 text-center">
            <p>
              This example uses local filesystem storage.
              <br />
              In production, use S3 or Vercel Blob storage.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
