    function isPointInsideElements(x, y, el) {
        const rect = el.getBoundingClientRect();
        if (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
        ) {
            return true; // Point inside the element

        return false;
    }}

    //Attach this function to each element detected by the observer
    function attachZoomEvents(target) {

        let clone = null;
        let zoomTimer = null;
        let touchStarted = false;
        let posTouched = [0, 0];
        
        function startZoomTimer() {

            const scale = 2.6;

            zoomTimer = setTimeout(() => {

                const rect = target.getBoundingClientRect();
                clone = target.cloneNode(true);
                clone.className = target.className;

                const parent = target.parentNode;

                //if a piece is dragged or has parent (meaning the piece has been dropped)
                if(((parent && parent.tagName.toLowerCase() === 'cg-board'&& parent.querySelector('.dragging')) ||parent===null)
                   //with not : we are on mobile (postTouched.x exists), and we are still hover the original case=ghost (however zoom impossible on mobile)
                  && !(isPointInsideElements(posTouched.x,posTouched.y,document.querySelector('.ghost'))))
                {
                    return; //no need to zoom anything, just go out the entire "startZoomTimer" function
                }

                const boardRect = parent.getBoundingClientRect();
                const zoomedSize = scale * rect.width

                let newTop = rect.top - boardRect.top
                let newLeft = rect.left - boardRect.left


                // Force the parent position if needed : static to relative
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

                //if on mobile, translate clone away from user thumb
                    if (posTouched.x){
                        translateY-= 0.6 * (zoomedSize-1)* Math.sign(newTop + rect.height/2 - boardRect.height/2);
                        translateX-= 0.6 * (zoomedSize-1)* Math.sign(newLeft + rect.width/2 - boardRect.width/2);
                    }
                    else{ //Desktop

                        // if the pieces are on the board (not next to)
                        if (parent && parent.tagName.toLowerCase() === 'cg-board'){

                            //Check if too close to board limit, define translatation values if so
                            if (newTop < (zoomedSize - rect.height) / 2) {
                                translateY+= ((zoomedSize - rect.height) / 2) - newTop;
                            } else if (newTop > boardRect.height - rect.height - (zoomedSize - rect.height) / 2) {
                                translateY+= (boardRect.height - rect.height - (zoomedSize - rect.height) / 2) - newTop;
                            }
                            if (newLeft < (zoomedSize - rect.width) / 2) {
                                translateX+= ((zoomedSize - rect.width) / 2) - newLeft;
                            } else if (newLeft > boardRect.width - rect.width - (zoomedSize - rect.width) / 2) {
                                translateX+= (boardRect.width - rect.width - (zoomedSize - rect.width) / 2) - newLeft;
                            }
                        }}
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
            posTouched.x = e.touches[0].clientX;
            posTouched.y = e.touches[0].clientY;
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

            posTouched.x = e.touches[0].clientX;
            posTouched.y = e.touches[0].clientY;
            let elementRef = target
            //On mobile, if a pièce is dragged, take the ghost as reference to clear the zoom
            if(target.parentNode && target.parentNode.tagName.toLowerCase() === 'cg-board'&& target.parentNode.querySelector('.dragging')){
                elementRef = document.querySelector(".ghost");
                }
            // if the touch point is no more on the reference element, clear zoom
            if (!isPointInsideElements(posTouched.x,posTouched.y,elementRef)){
                clearZoom();
                touchStarted = false;
            }
        });
    }

    // Observer to dynamically attach zoom events to new pieces
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

    // apply to existing pieces
    document.querySelectorAll('piece').forEach(attachZoomEvents);