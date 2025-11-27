import React from 'react';
import { LaserEyesApp } from './components/LaserEyesApp';

const App: React.FC = () => {
  return (
    <div className="w-full h-screen bg-black text-white relative overflow-hidden font-mono">
      <LaserEyesApp />
    </div>
  );
};

export default App;