# Swap Calculator

A web app tool used to calculate the projected floating rates and net cash flows of multiple and different interest rate swaps across different payment dates. By modeling projected market index rates using cash, futures, and par swap rates, this calculator simplifies complex financial hedges into actionable data, quantifying proffability and risk of different swap positions.
Built using Python (flask) and plain HTML/JS/CSS; this is an ongoing collaborative project to familiarize ourselves with the underlying concepts of pricing a derivative.

## Table of Contents
- [Showcase](#Showcase)
- [What is a swap?-Summary](#what-is-a-swap)
- [User Guide](#user-guide)
  - [Installation](#installation)
  - [Features](#features--workflows)
  - [Workflow and Examples] (#Workflow and Examples)
- [Documentation & Guides](#documentation--guides)
- [Acknowledgments & References](#acknowledgments--references)
- [Contributors](#contributors)

<br>

## Showcase

![App Screenshot Placeholder](./assets/screenshot.png)
#PICTURE OF IT IN ACTION

#DEMO VIDEO PERHAPS

## What is a Swap?

A swap is a financial contractual agreement between two parties where they exchange interest rates; essentially, one party chooses to pay a typically fixed rate over a floating rate.
This enables investors to manage risk, hedging against the risk of paying more interest if the floating rate suddenly skyrockets (in this specific example)
While there are many different variations to the structure of a swap, the core idea essentially remains the same -- BY projecting the interest rate of a market index; using observed priced cash rates, future rates, and par swap rates with increasing tenors, future cashflows for each payment date can be modeled, and the net profitability and risk exposure of a swap can be quantified. 

The core attributes defined in a swap contract:
				The notional principle: Baseline value, used for calculating interest
				The receiving and paying interest rates: Can either be fixed, or floating (continuous change, w.r.t market interest rates?).
				Trade Date: the day where the swap takes effect/occurs
				Tenor: The length of time remaining before the swap matures/expires
				Basis/Convention: The agreed upon convention used to determine effective number of days interest accrued, in-between payment dates
				Frequency of Payments: How many payment dates are there in a year 

## User Guide

### Installation
1. Clone the repository: `git clone https://github.com/podledges/Swap-Calculator`
2. Create and Activate Python Enviornement, or create a Conda Enviornement 
3. Install the packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the Flask server:
   ```bash
   python src/app.py
   ```
5. Open `http://127.0.0.1:5000` in your browser.

If you just want to run the quant engine in the command line, you can run `python src/main.py` which will calculate swap NPVs and use matplotlib to show the curves.

### Deployment
It is configured to run on Render via `render.yaml` and `Procfile` using Gunicorn.

### Features & Workflows

#### Interest Rate Swap
- **Feature:** Brief description of what this tab allows the user to do.
- **Example Workflow:**  LIKE USE A REAL WORLD SCENARIO, LIKE WITH HOW MY INCOME IS SET UP, I CAN ONLY AFFORD TO PAY NOTHIGN MORE THAN 6% interest -- the rate right now is 4.6%, I am chilling, but if it suddenly spikes, i am cooked, so lets swap that for a 5% interest rate.
  1. Input your initial parameters.
  2. Select your desired tenor.
  3. View the generated cash flow chart.

#### Cross-Currency Swap
- **Feature:** Prices multi-currency swaps using Covered Interest Parity to project FX forward rates and amortize principal exchange.
- **Example Workflow:** 1. Input your initial parameters.
  2. Select your desired tenor.
  3. View the generated cash flow chart.

#### Cross-Asset Swap
- **Feature:** Supports asset return legs where payments are tied to the performance of an underlying asset (like a stock or commodity) instead of a fixed/floating interest rate..
- **Example Workflow:** 1. Input your initial parameters.
  2. Select your desired tenor.
  3. View the generated cash flow chart.

#### Portfolio Manager
- **Swap Portfolio Pricing**: Prices multiple swap positions, shows NPV and DV01 (PVBP), and maps out scheduled cashflows.
- **Unified Swap Portfolio**: *in development*, Master Swap portfolio, containing info about the accumulative NPV and PVBP across different swap types;.
 

- **Liquidity Filter**: Automatically filters out overlapping tenors based on the lowest bid/ask spread (most liquid). do we actuallly have this


## Documentation & Guides
- [Architecture Overview](./docs/architecture.md)
- [API Reference](./docs/api.md)
- **Math Docs**: A docs page and a LaTeX file (`financial-math.tex`) explaining the math formulas.

## Acknowledgments & References
**References**
* **Miron, Paul. *Pricing and Hedging Swaps*.** This book served as our primary educational resource and reference guide. It provided the foundational knowledge on pricing methods, swap valuation, and the underlying mathematics that power the core logic of this calculator. 

**Inspiration**
* **[AnimeStats](https://www.animestats.tf/)**
  This site served as our main inspiration for the user interface. We referenced its layout and visual design heavily when structuring the frontend of our application.

## Contributors

- [@podledges](https://github.com/podledges) (Ayden) - Developer
- [@Iota113](https://github.com/Iota113) (Henry) - Developer
- [@yunn-ctrl] 