import { Routes , Route } from "react-router-dom"
import HomePage from "./pages/home"
import PdfCropperPage from "./pages/pdf-cropper"

function App() {
  return (
    <Routes >
      <Route path="/" element={<HomePage />} />
      <Route path="/pdf-cropper" element={<PdfCropperPage />} />
    </Routes>
  )
}

export default App
