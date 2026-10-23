import { Navigate, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="/morning" element={<div style={{ padding: '2rem' }}>Morning page is being migrated.</div>} />
      <Route path="/school-sabbath" element={<div style={{ padding: '2rem' }}>Sabbath School page is being migrated.</div>} />
      <Route path="/preachers" element={<div style={{ padding: '2rem' }}>Preachers page is being migrated.</div>} />
      <Route path="/admin" element={<div style={{ padding: '2rem' }}>Admin page is being migrated.</div>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
