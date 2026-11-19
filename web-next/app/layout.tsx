import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'OSMANX PROOF — Work that proves itself',description:'Превращайте запросы клиентов в готовые предложения и результаты — без обязательных приглашений.',robots:'noindex,nofollow'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>}
