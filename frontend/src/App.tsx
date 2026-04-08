import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { router } from './router';
import { queryClient } from './lib/queryClient';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--toast-bg, #1e293b)',
            color: 'var(--toast-color, #f1f5f9)',
            borderRadius: '12px',
            fontSize: '14px',
            border: '1px solid rgba(255,255,255,0.1)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
