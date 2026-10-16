import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./features/auth/AuthProvider";
import { EstadoUsuarioProvider } from "./features/perfil/EstadoUsuarioProvider";
import { AppRoutes } from "./routes/AppRoutes";
import "./styles.css";
export function App() {
  return <BrowserRouter><AuthProvider><EstadoUsuarioProvider><AppRoutes /></EstadoUsuarioProvider></AuthProvider></BrowserRouter>;
}
