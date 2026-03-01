# FINDINGS REPORT

## Overview

The review of the crowdfunding backend API focused on authentication, authorization, database integrity, and financial consistency. The system was well structured but contained several common backend security and business logic risks typical in junior-level production implementations.

## Issues Found

### 1. Pledge Privacy Exposure

**Issue**

* Public pledge listing exposed:

  * `backer_id`
  * Payment status history including pending transactions

**How I Found It**

* Tested GET pledge endpoints using Postman.
* Reviewed SQL query responses from pledge routes.

**Real-World Impact**

* Could allow user tracking across campaigns.
* Could expose sensitive payment behavior.

**Fix Priority**
Medium.

### 2. Campaign Deadline Validation Missing (Fixed)

**Issue**

* Users could pledge to campaigns after deadlines passed.

**How I Found It**

* Tested pledge creation using campaigns seeded with past deadlines.

**Real-World Impact**

* Financial and business rule violations.
* Users could fund inactive campaigns.

**Fix Priority**
High.

### 3. Race Condition in Funding Updates (Fixed)

**Issue**

* Raised funding totals were updated separately from pledge creation.

**How I Found It**

* Reviewed database update logic and transaction flows.

**Real-World Impact**

* Concurrent requests could cause inaccurate funding totals.

**Fix Priority**
High.

### 4. Pledge Cancellation Funding Inconsistency (Fixed)

**Issue**

* Cancelled pledges were not deducted from campaign raised totals.

**Real-World Impact**

* Campaigns could appear funded even after pledge withdrawals.

**Fix Priority**
High.

## Solutions Implemented

### Database Transaction Handling

Transactions were added to:

* Prevent race conditions.
* Maintain financial data integrity.

### Business Rule Validation
Added checks for:

* Campaign deadlines.
* Campaign status before allowing pledges.

### Funding Consistency

Raised amounts are now updated atomically during pledge lifecycle changes.

## Prioritization Rationale

Fixes were prioritized based on:

1. Financial correctness
2. Security enforcement
3. Business rule validation

These are critical for crowdfunding platform reliability.

## Conclusion

The system demonstrates strong backend API design principles, with improvements in data consistency, security, and business rule enforcement. Future improvements could include integration with real payment gateways and more granular audit logging.

