// The shared game files read import.meta.env (Vite); in the Worker it does not exist.
interface ImportMeta { readonly env?: Record<string, string | undefined> }
