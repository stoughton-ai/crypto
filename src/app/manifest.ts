import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Crypto Traffic Light',
        short_name: 'CryptoTL',
        description: 'Advanced crypto research using AI AI Research Analyst',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
            {
                src: '/icon.jpg',
                sizes: 'any',
                type: 'image/jpeg',
            },
        ],
    }
}
