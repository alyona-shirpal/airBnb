import { Request, Response, NextFunction } from 'express';

import { stripe } from '../../services/stripe.service';
import { User, UserPaymentInfo, Booking, Transaction } from '../../db/models';
import { Op } from 'sequelize';

const createBankCard = async (req:Request, res: Response, next: NextFunction) => {
    try {
        // the credit card info comes from front to stripe, stripe gives for last digits and token
        const creditCard = await stripe.paymentMethods.create({
            card: {
                number: '4242424242424242',
                exp_month: 9,
                exp_year: 2025,
                cvc: '314'
            },
            type: 'card'
        });

        const cardInfo = await stripe.paymentMethods.retrieve(creditCard.id);

        const user = await User.findOne({
            where: {
                user_id: req.user.user_id
            }
        }) as User;

        let stripe_customer_id = '';

        // create custumer on stripe if user doesnt have any, new user has stripe_id
        if (!user.stripe_id) {
            const stripeCustomer = await stripe.customers.create({
                email: user!.email,
                payment_method: cardInfo.id,
                name: user.first_name || ''
            });

            stripe_customer_id = stripeCustomer.id;

            await user.set('stripe_id', stripeCustomer.id).save();
        }

        if (!cardInfo.customer) {
            await stripe.paymentMethods.attach(cardInfo.id, { customer: user.stripe_id || stripe_customer_id });
        }

        await UserPaymentInfo.create({
            user,
            user_id: req.user.user_id,
            last_4_digits: cardInfo.card?.last4,
            stripe_token: cardInfo.id,
            vendor: cardInfo.card?.brand
        });

        return res.status(200).send();
    } catch (e) {
        next(e);
    }
};

const payingProcess = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = await User.findOne({
            where: {
                user_id: req.user.user_id,
                stripe_id: {
                    [Op.not]: null
                }
            }
        });

        if (!user) {
            return res.status(404).send('USER_NOT_FOUND');
        }

        const card = await UserPaymentInfo.findOne({
            where: {
                id: req.params.cardId
            }
        });

        if (!card) {
            return res.status(404).send('CARD_NOT_FOUND');
        }

        const price = await Booking.findOne( { where:{
                user_id: req.user.user_id,
                id: req.params.booking_id
            } } );

        if (!price) {
            return res.status(404);
        }

        const priceInCent = price.total_price * 100;

        await stripe.paymentIntents.create({
            amount: priceInCent,
            currency: 'USD',
            customer: user.stripe_id,
            payment_method: card.stripe_token,
            confirm: true
        });

        const transaction: any = {};
        transaction.amount = price.total_price;
        transaction.tenent_id = req.user.user_id;
        transaction.apartment_id = price.apartment_id;

        await Transaction.create(transaction);

        return res.status(200).send();
    } catch (e) {
        next(e);
    }
};
export { createBankCard, payingProcess };
