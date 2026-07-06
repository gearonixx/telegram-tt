import type { ApiError, ApiFieldError } from '../api/types';

const SHIPPING_ERRORS: Record<string, ApiFieldError> = {
  ADDRESS_STREET_LINE1_INVALID: {
    field: 'streetLine1',
    message: 'Incorrect street address',
  },
  ADDRESS_STREET_LINE2_INVALID: {
    field: 'streetLine2',
    message: 'Incorrect street address',
  },
  ADDRESS_CITY_INVALID: {
    field: 'city',
    message: 'Incorrect city',
  },
  ADDRESS_COUNTRY_INVALID: {
    field: 'countryIso2',
    message: 'Incorrect country',
  },
  ADDRESS_POSTCODE_INVALID: {
    field: 'postCode',
    message: 'Incorrect post code',
  },
  ADDRESS_STATE_INVALID: {
    field: 'state',
    message: 'Incorrect state',
  },
  REQ_INFO_NAME_INVALID: {
    field: 'fullName',
    message: 'Incorrect name',
  },
  REQ_INFO_PHONE_INVALID: {
    field: 'phone',
    message: 'Incorrect phone',
  },
  REQ_INFO_EMAIL_INVALID: {
    field: 'email',
    message: 'Incorrect email',
  },
};

const FINAL_PAYMENT_ERRORS = new Set([
  'BOT_PRECHECKOUT_FAILED',
  'PAYMENT_FAILED',
]);

export function getShippingError(error: ApiError): ApiFieldError | undefined {
  return SHIPPING_ERRORS[error.message];
}

export function shouldClosePaymentModal(error: ApiError): boolean {
  return FINAL_PAYMENT_ERRORS.has(error.message);
}
