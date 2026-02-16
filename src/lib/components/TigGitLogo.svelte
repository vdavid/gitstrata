<script lang="ts">
    // Tig→git swap animation refs
    let tigGroupEl: HTMLSpanElement | undefined = $state()
    let tigTEl: HTMLSpanElement | undefined = $state()
    let tigIEl: HTMLSpanElement | undefined = $state()
    let tigGEl: HTMLSpanElement | undefined = $state()

    // Stratigraphy tooltip
    let showStratTooltip = $state(false)
    let stratTooltipEl: HTMLDivElement | undefined = $state()
    let stratTriggerEl: HTMLButtonElement | undefined = $state()

    // Measure tig character widths after fonts load, so the swap animation is pixel-perfect.
    // Also listens for animationend to hand off from the initial CSS animation to JS control.
    $effect(() => {
        if (!tigGroupEl || !tigTEl || !tigIEl || !tigGEl) return
        const group = tigGroupEl
        const t = tigTEl
        const i = tigIEl
        const g = tigGEl
        document.fonts.ready.then(() => {
            const fontSize = parseFloat(getComputedStyle(t).fontSize)
            const wt = t.getBoundingClientRect().width
            const wi = i.getBoundingClientRect().width
            const wg = g.getBoundingClientRect().width
            group.style.setProperty('--tig-dt', `${(wi + wg) / fontSize}em`)
            group.style.setProperty('--tig-dg', `${(wt + wi) / fontSize}em`)
            group.style.setProperty('--tig-di', `${(wg - wt) / fontSize}em`)
        })
        group.addEventListener('animationend', handleTigAnimationEnd)
        return () => group.removeEventListener('animationend', handleTigAnimationEnd)
    })

    // --- Tig↔git interactive hover swap ---
    type SwapPhase =
        | 'initial'
        | 'showing-git'
        | 'hover-pending'
        | 'animating-to-tig'
        | 'showing-tig'
        | 'animating-to-git'

    let swapPhase: SwapPhase = 'initial'
    let swapNeedsFreshEnter = true
    let swapIsHovering = false
    let swapHoverTimer: ReturnType<typeof setTimeout> | undefined
    let swapRevertTimer: ReturnType<typeof setTimeout> | undefined
    let swapAnim: Animation | null = null

    const swapAnimate = (from: number, to: number, onDone: () => void) => {
        swapAnim?.cancel()
        swapAnim = null
        if (!tigGroupEl) return
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        tigGroupEl.style.setProperty('--tig-swap', String(from))
        swapAnim = tigGroupEl.animate([{ '--tig-swap': String(from) }, { '--tig-swap': String(to) }], {
            duration: reducedMotion ? 1 : 2000,
            easing: 'linear',
            fill: 'forwards',
        })
        swapAnim.addEventListener(
            'finish',
            () => {
                tigGroupEl?.style.setProperty('--tig-swap', String(to))
                swapAnim?.cancel()
                swapAnim = null
                onDone()
            },
            { once: true },
        )
    }

    const swapStartRevertTimer = () => {
        if (swapRevertTimer) clearTimeout(swapRevertTimer)
        swapRevertTimer = setTimeout(() => {
            swapRevertTimer = undefined
            swapPhase = 'animating-to-git'
            swapAnimate(0, 1, () => {
                swapPhase = 'showing-git'
                swapNeedsFreshEnter = swapIsHovering
            })
        }, 5000)
    }

    const handleTigAnimationEnd = (e: AnimationEvent) => {
        if (e.animationName !== 'tig-swap-anim' || swapPhase !== 'initial') return
        if (!tigGroupEl) return
        tigGroupEl.style.animation = 'none'
        tigGroupEl.style.setProperty('--tig-swap', '1')
        swapPhase = 'showing-git'
        swapNeedsFreshEnter = swapIsHovering
    }

    const handleTigMouseEnter = () => {
        swapIsHovering = true
        if (swapPhase === 'showing-git' && !swapNeedsFreshEnter) {
            swapPhase = 'hover-pending'
            swapHoverTimer = setTimeout(() => {
                swapHoverTimer = undefined
                swapPhase = 'animating-to-tig'
                swapAnimate(1, 0, () => {
                    swapPhase = 'showing-tig'
                    if (!swapIsHovering) swapStartRevertTimer()
                })
            }, 100)
        } else if (swapPhase === 'showing-tig') {
            if (swapRevertTimer) {
                clearTimeout(swapRevertTimer)
                swapRevertTimer = undefined
            }
        }
    }

    const handleTigMouseLeave = () => {
        swapIsHovering = false
        if (swapPhase === 'showing-git') {
            swapNeedsFreshEnter = false
        } else if (swapPhase === 'hover-pending') {
            if (swapHoverTimer) clearTimeout(swapHoverTimer)
            swapHoverTimer = undefined
            swapPhase = 'showing-git'
        } else if (swapPhase === 'showing-tig') {
            swapStartRevertTimer()
        }
    }

    // Cleanup swap timers/animation on unmount
    $effect(() => {
        return () => {
            if (swapHoverTimer) clearTimeout(swapHoverTimer)
            if (swapRevertTimer) clearTimeout(swapRevertTimer)
            swapAnim?.cancel()
        }
    })

    const toggleStratTooltip = () => {
        showStratTooltip = !showStratTooltip
    }

    // Close stratigraphy tooltip on click-outside or Escape
    $effect(() => {
        if (!showStratTooltip) return
        const handleClose = (e: MouseEvent) => {
            const target = e.target as Node
            if (stratTooltipEl?.contains(target) || stratTriggerEl?.contains(target)) return
            showStratTooltip = false
        }
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') showStratTooltip = false
        }
        // Delay click listener to avoid catching the opening click
        const raf = requestAnimationFrame(() => {
            window.addEventListener('click', handleClose)
        })
        window.addEventListener('keydown', handleEscape)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener('click', handleClose)
            window.removeEventListener('keydown', handleEscape)
        }
    })
</script>

<!-- Decorative tig↔git animation easter egg, not an interactive control -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- prettier-ignore -->
<h1
	class="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl"
	style="font-family: var(--font-sans); letter-spacing: -0.025em;"
><button
	class="strat-trigger"
	bind:this={stratTriggerEl}
	onclick={toggleStratTooltip}
	aria-expanded={showStratTooltip}
><span class="strat-underline">Stra<span
	class="tig-group"
	bind:this={tigGroupEl}
	onmouseenter={handleTigMouseEnter}
	onmouseleave={handleTigMouseLeave}
><span class="tig-char tig-t text-accent" bind:this={tigTEl}>t</span><span class="tig-char tig-i text-accent" bind:this={tigIEl}>i</span><span class="tig-char tig-g text-accent" bind:this={tigGEl}>g</span></span>raphy</span></button> for your code</h1>
{#if showStratTooltip}
    <div class="strat-tooltip strata-fade-in" bind:this={stratTooltipEl}>
        <p>
            <strong>Stratigraphy</strong> is a branch of geology concerned with the study of rock layers (<em>strata</em
            >) and layering (<em>stratification</em>).<sup class="strat-tooltip-ref">[1]</sup>
            It is primarily used in the study of sedimentary and layered volcanic rocks.
        </p>
        <p class="strat-tooltip-source">
            from <a href="https://en.wikipedia.org/wiki/Stratigraphy" target="_blank" rel="noopener noreferrer"
                >Wikipedia, the free encyclopedia</a
            >
        </p>
        <hr class="strat-tooltip-divider" />
        <p>
            <strong>Stra<span class="text-accent">git</span>raphy</strong> is the science of how your repo's layers (<em
                >strata</em
            >) went from <code>git init</code> to whatever it is now. It's a whole bunch faster than real stratigraphy.
        </p>
        <p class="strat-tooltip-source">
            proudly made up by <a
                href="https://www.linkedin.com/in/veszelovszki/"
                target="_blank"
                rel="noopener noreferrer">@vdavid</a
            >
        </p>
    </div>
{/if}
