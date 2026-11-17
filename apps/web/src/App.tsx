import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import Login from './pages/Login';
import Register from './pages/Register';
import Drive from './pages/Drive';
import Shared from './pages/Shared';

function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/shared/:token" element={<Shared />} />
        <Route path="/" element={<Protected><Drive /></Protected>} />
        <Route path="/drive/*" element={<Protected><Drive /></Protected>} />
      </Routes>
    </AuthProvider>
  );
}