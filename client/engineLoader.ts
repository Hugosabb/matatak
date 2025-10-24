export function loadEngine(): Promise<void> {
    if (window['fsf'] || window['fsfLoading']) {
        return Promise.resolve();
    }

    window['fsfLoading'] = true;

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/static/stockfish.js';
        script.async = true;

        script.onload = () => {
            if (typeof Stockfish === 'function') {
                Stockfish().then((fsf: any) => {
                    fsf.addMessageListener((line: string) => {
                        if (window.onFSFline) {
                            window.onFSFline(line);
                        }
                    });
                    
                    window['fsf'] = fsf;
                    window['fsfLoading'] = false;
                    
                    resolve();
                }).catch(reject);
            } else {
                reject(new Error('Stockfish function not found after loading script.'));
            }
        };

        script.onerror = () => reject(new Error('Failed to load stockfish.js'));
        document.head.appendChild(script);
    });
}
