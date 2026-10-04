import { createBrowserRouter } from 'react-router';
import { ImplementationBoundaryPage } from '../pages/ImplementationBoundaryPage';

export const router = createBrowserRouter([{ path: '*', Component: ImplementationBoundaryPage }]);
