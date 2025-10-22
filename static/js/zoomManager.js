function attachZoomEvents(target) {

        let clone = null;
        let zoomTimer = null;
        let touchStarted = false;

        function startZoomTimer() {

            const scale = 2.6;

            zoomTimer = setTimeout(() => {

                const rect = target.getBoundingClientRect();
                console.log
                clone = target.cloneNode(true);
                clone.className = target.className + ' zoomed-image';

                const parent = target.parentNode;
                const boardRect = parent.getBoundingClientRect();
                const zoomedSize = scale * rect.width

                let newTop = rect.top - boardRect.top
                let newLeft = rect.left - boardRect.left


                // Forcer position: relative sur le parent si nécessaire
                const computedParentStyle = getComputedStyle(parent);
                if (computedParentStyle.position === 'static') {
                    parent.style.position = 'relative';
                }

                Object.assign(clone.style, {
                    position: 'absolute',
                    transition: `transform 0.3s`,
                    top: `${rect.top - boardRect.top}px`,
                    left: `${rect.left - boardRect.left}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    pointerEvents: 'None',
                    transform: 'scale(1)',
                    zIndex: '9999',
                    backgroundSize: '100%',
                    borderRadius: '5%',
                    boxShadow: '0 0 20px rgba(0,0,0,0.5)'
                });

                parent.appendChild(clone);

                //20ms timeout to let the clone appears and enable the animation to the next position
                setTimeout(() => {
                // Apply the board correction and scale factor
                let translateX = 0;
                let translateY = 0;

                // if the pieces are on the board (not next to)
                if (parent && parent.tagName.toLowerCase() === 'cg-board'){

                    //Check if close to the board limit, define translatation values if so
                    if (newTop < (zoomedSize - rect.height) / 2) {
                        translateY = ((zoomedSize - rect.height) / 2) - newTop;
                    } else if (newTop > boardRect.height - rect.height - (zoomedSize - rect.height) / 2) {
                        translateY = (boardRect.height - rect.height - (zoomedSize - rect.height) / 2) - newTop;
                    }
                    if (newLeft < (zoomedSize - rect.width) / 2) {
                        translateX = ((zoomedSize - rect.width) / 2) - newLeft;
                    } else if (newLeft > boardRect.width - rect.width - (zoomedSize - rect.width) / 2) {
                        translateX = (boardRect.width - rect.width - (zoomedSize - rect.width) / 2) - newLeft;
                    }
                }
                    // apply scale + translate
                    clone.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;

                }, 20);
            }, 1000);
        }

        function clearZoom() {
            clearTimeout(zoomTimer);
            zoomTimer = null;
            if (clone) {
                clone.remove();
                clone = null;
            }
        }

        // Desktop
        target.addEventListener('mouseenter', startZoomTimer);
        target.addEventListener('mouseleave', clearZoom);

        // Mobile
        target.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchStarted = true;
            startZoomTimer();
        });

        target.addEventListener('touchend', () => {
            clearZoom();
            touchStarted = false;
        });

        target.addEventListener('touchcancel', () => {
            clearZoom();
            touchStarted = false;
        });

        document.addEventListener('touchmove', (e) => {
            if (!touchStarted) return;

            const touch = e.touches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            const isStillOverTarget = el?.closest('piece') === target;

            if (!isStillOverTarget) {
                clearZoom();
                touchStarted = false;
            }
        });
    }

    // Observer pour les ajouts dynamiques
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    if (node.tagName.toLowerCase() === 'piece') {
                        attachZoomEvents(node);
                    }
                    node.querySelectorAll?.('piece').forEach(attachZoomEvents);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Appliquer immédiatement aux éléments déjà présents
    document.querySelectorAll('piece').forEach(attachZoomEvents);