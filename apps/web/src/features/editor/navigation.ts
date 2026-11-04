export type NavigationGuard = () => boolean | Promise<boolean>;
export type RegisterGuard = (guard: NavigationGuard | null) => void;
