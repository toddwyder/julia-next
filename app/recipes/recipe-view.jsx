'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { projectAmounts } from '../../lib/recipe-display';
import { browserRecipeStorage, markLastStep, markOpened, readLastStep } from '../../lib/recipe-history';
import { useRecipeSource } from './recipe-provider';
import styles from './recipes.module.css';

function WrittenLines({ text, rowClass }) {
  return text.split('\n').map((line, index) => <Fragment key={index}>
    {index > 0 ? '\n' : null}<span className={line === '' ? styles.blankLine : rowClass}>{line}</span>
  </Fragment>);
}

function IngredientRows({ rows, baskets = false }) {
  return <ul className={baskets ? styles.fullIngredients : styles.portionIngredients}>
    {rows.map(row => <li key={row.ingredientId} data-ingredient-id={row.ingredientId}>
      {baskets ? <img src="/apothecary/basket.png" width="36" height="36" alt="" /> : null}
      <span>{row.name}</span><strong className={styles.amount}>{row.amount}</strong>
    </li>)}
  </ul>;
}

function SectionHeading({ children, id }) {
  return <h2 className={styles.apSectionHeading} id={id}><span aria-hidden="true" className={styles.headingRule} />{children}<span aria-hidden="true" className={styles.headingRule} /></h2>;
}

export default function RecipeView({ recipe }) {
  const { scope } = useRecipeSource();
  const linked = recipe.content.kind === 'linked';
  const steps = linked ? recipe.content.steps : [];
  const [servings, setServings] = useState(linked ? recipe.content.baseServings : null);
  const [servingsInput, setServingsInput] = useState(String(linked ? recipe.content.baseServings : ''));
  const [units, setUnits] = useState('us');
  const [lastStep, setLastStep] = useState(null);
  const [restored, setRestored] = useState(false);
  const [cooking, setCooking] = useState(false);
  const elements = useRef(new Map());
  const activeId = useRef(null);
  const amounts = linked ? projectAmounts(recipe.content, { servings, units }) : null;

  useEffect(() => {
    const storage = browserRecipeStorage();
    const saved = readLastStep(storage, scope, recipe);
    activeId.current = saved;
    setLastStep(saved);
    setRestored(true);
    markOpened(storage, scope, recipe.id);
    const sync = () => {
      const next = readLastStep(storage, scope, recipe);
      activeId.current = next;
      setLastStep(next);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [scope, recipe]);

  const selectStep = useCallback(id => {
    activeId.current = id;
    setLastStep(id);
    markLastStep(browserRecipeStorage(), scope, recipe.id, id);
  }, [scope, recipe.id]);

  useEffect(() => {
    if (!restored || !linked || cooking) return;
    let reading = false;
    let frame;
    const engage = event => {
      if (event.type !== 'keydown' || ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(event.key)) reading = true;
    };
    const onScroll = () => {
      if (!reading) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const targetY = Math.min(200, window.innerHeight * 0.3);
        const visible = steps.map(step => ({ id: step.id, box: elements.current.get(step.id)?.getBoundingClientRect() }))
          .filter(({ box }) => box && box.bottom > targetY && box.top < window.innerHeight * 0.75);
        const next = visible.sort((a, b) => Math.abs(a.box.top - targetY) - Math.abs(b.box.top - targetY))[0];
        if (next && next.id !== activeId.current) selectStep(next.id);
      });
    };
    for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.addEventListener(event, engage, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.removeEventListener(event, engage);
      window.removeEventListener('scroll', onScroll);
    };
  }, [restored, linked, cooking, steps, selectStep]);

  function changeServings(value) {
    setServingsInput(value);
    const next = Number(value);
    if (Number.isSafeInteger(next) && next >= 1) setServings(next);
  }
  function moveTo(id) {
    selectStep(id);
    requestAnimationFrame(() => elements.current.get(id)?.focus({ preventScroll: false }));
  }
  function startCooking() {
    setCooking(true);
    moveTo(lastStep ?? steps[0].id);
  }
  const currentIndex = steps.findIndex(s => s.id === lastStep);

  return <main className={`${styles.apothecaryPage} ${styles.recipePage}`}>
    <article>
      <div className={styles.recipeHead}>
        <Link className={styles.backLink} href="/recipes">← Library</Link>
        <h1 className={styles.displayHeading} data-testid="recipe-title">{recipe.title}</h1>
        {recipe.origin === 'synthetic' ? <p className={styles.recipeProvenance}>Synthetic recipe · {recipe.totalMinutes} minutes · Demonstration only</p> : null}
        {linked ? <div className={styles.readControls}>
          <div className={styles.servingsControl}>
            <button type="button" aria-label="Fewer servings" disabled={servings === 1} onClick={() => changeServings(String(servings - 1))}>−</button>
            <label htmlFor="servings">Serves</label>
            <input id="servings" aria-label="Servings" type="number" min="1" step="1" value={servingsInput} onChange={e => changeServings(e.target.value)} onBlur={() => setServingsInput(String(servings))} />
            <button type="button" aria-label="More servings" onClick={() => changeServings(String(servings + 1))}>+</button>
          </div>
          <div className={styles.units} role="group" aria-label="Measurement units">
            <button type="button" aria-pressed={units === 'us'} onClick={() => setUnits('us')}>US</button>
            <button type="button" aria-pressed={units === 'metric'} onClick={() => setUnits('metric')}>Metric</button>
          </div>
        </div> : <p className={styles.unavailable}>Servings, timing and conversions are unavailable for this written recipe.</p>}
      </div>
      {linked && !cooking ? <button type="button" className={styles.startCooking} onClick={startCooking}>Start cooking</button> : null}
      <p className={styles.shoppingUnavailable}>Add to shopping list <span>is not available yet.</span></p>

      {!cooking ? <section aria-labelledby="ingredients-heading">
        <SectionHeading id="ingredients-heading">{linked ? 'Ingredients' : 'The Ingredients'}</SectionHeading>
        {linked ? <div data-testid="recipe-ingredients"><IngredientRows rows={amounts.ingredients} baskets /></div>
          : <div data-testid="recipe-ingredients" className={styles.writtenIngredients}><WrittenLines text={recipe.content.ingredients} rowClass={styles.writtenIngredient} /></div>}
      </section> : null}

      <section aria-labelledby="preparation-heading">
        <SectionHeading id="preparation-heading">Preparation</SectionHeading>
        {cooking ? <div className={styles.cookNavigation} role="group" aria-label="Cook mode">
          <p>Step {currentIndex + 1} of {steps.length}</p>
          <button type="button" disabled={currentIndex <= 0} onClick={() => moveTo(steps[currentIndex - 1].id)}>Previous</button>
          <button type="button" disabled={currentIndex === steps.length - 1} onClick={() => moveTo(steps[currentIndex + 1].id)}>Next</button>
          <button type="button" onClick={() => setCooking(false)}>Exit cooking</button>
        </div> : null}
        {linked ? <div className={styles.linkedSteps} data-testid="recipe-steps">
          {steps.map((step, index) => <section key={step.id} id={`step-${step.id}`} data-step-id={step.id}
            ref={element => { if (element) elements.current.set(step.id, element); else elements.current.delete(step.id); }}
            tabIndex={0} aria-label={`Step ${index + 1}`} aria-current={lastStep === step.id ? 'step' : undefined}
            hidden={cooking && lastStep !== step.id}
            className={`${styles.cookingStep} ${lastStep === step.id ? styles.stoppedStep : ''}`}
            onFocus={() => { if (restored) selectStep(step.id); }} onClick={() => selectStep(step.id)}>
            {lastStep === step.id ? <span className={styles.stoppedMarker}>You stopped here</span> : null}
            <div className={`${styles.cartouche} ${styles.stepLabel}`}>
              <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
              {amounts.steps[index].ingredients.length ? <IngredientRows rows={amounts.steps[index].ingredients} /> : <p className={styles.noIngredients}>No ingredients</p>}
            </div>
            <p className={styles.instruction}>{step.instruction}</p>
          </section>)}
        </div> : <>
          <p className={styles.unavailable}>Step ingredients have not been linked. The instructions below are preserved as written.</p>
          <div className={styles.writtenSteps} data-testid="recipe-steps"><WrittenLines text={recipe.content.steps} rowClass={styles.writtenStep} /></div>
        </>}
      </section>
      {recipe.notes ? <section className={styles.recipeNotes}><SectionHeading>Notes</SectionHeading><p>{recipe.notes}</p><p className={styles.sourceLine}>Source · {recipe.source.label}</p></section> : null}
      <section className={styles.nutrition} aria-labelledby="nutrition-heading">
        <SectionHeading id="nutrition-heading">Nutrition</SectionHeading>
        {recipe.nutrition ? <>
          <p className={styles.estimateNotice}>Estimated per serving. Synthetic, illustrative values.</p>
          <dl className={styles.nutritionSummary}>
            <div><dt>Score <span>estimated</span></dt><dd>~{recipe.nutrition.score} / 100</dd></div>
            <div><dt>Glycemic load <span>estimated</span></dt><dd>~{recipe.nutrition.glycemicLoad} · {recipe.nutrition.glycemicLoad <= 10 ? 'Low' : recipe.nutrition.glycemicLoad < 20 ? 'Medium' : 'High'}</dd></div>
          </dl>
          <dl className={styles.nutritionValues}>{[['Energy', `${recipe.nutrition.calories} kcal`], ['Protein', `${recipe.nutrition.protein} g`], ['Carbohydrate', `${recipe.nutrition.carbs} g`], ['Fat', `${recipe.nutrition.fat} g`]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        </> : <p>Score, glycemic load and per-serving nutrition estimates are unavailable for this written recipe.</p>}
      </section>
      <footer className={styles.recipeFooter}>
        <p>Sharing, editing and Riff are not available yet.</p>
        <Link href="/recipes">Back to the Library</Link>
      </footer>
    </article>
  </main>;
}
